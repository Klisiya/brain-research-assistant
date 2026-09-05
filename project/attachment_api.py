"""Attachment API registration, authorization, and database/file compensation."""
from functools import wraps
import os

import click
from flask import current_app, g, jsonify, request, send_file, url_for
from flask_login import current_user
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.exc import StaleDataError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from attachment_files import AttachmentError, FILE_LIMITS, safe_filename, too_large, validate_file, validate_metadata
from storage import LocalAttachmentStorage, StorageWriteError


def register_attachment_api(app, db, Paper, Attachment, Cleanup, roles_required,
                            can_manage_paper, paper_not_found_response):
    app.config.setdefault("MAX_CONTENT_LENGTH", 64 * 1024 * 1024)
    # Flask defines this key as None, so setdefault alone would not set a limit.
    if app.config["MAX_CONTENT_LENGTH"] is None:
        app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
    app.config.setdefault("ATTACHMENT_UPLOAD_ROOT", os.path.join(app.instance_path, "uploads"))
    app.config.setdefault("ATTACHMENT_FILE_LIMITS", dict(FILE_LIMITS))

    def storage():
        return current_app.extensions.get("attachment_storage") or LocalAttachmentStorage(
            current_app.config["ATTACHMENT_UPLOAD_ROOT"]
        )

    def log_failure(operation, error):
        app.logger.error("Attachment operation=%s actor=%s category=%s", operation,
                         current_user.get_id() if current_user else None, type(error).__name__)

    def error_response(error):
        return jsonify({"error": str(error), "code": error.code}), error.status

    @app.errorhandler(RequestEntityTooLarge)
    def file_too_large(_error):
        return error_response(too_large())

    @app.after_request
    def attachment_headers(response):
        if request.path.startswith("/api/papers/") and "/attachments" in request.path:
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.vary.add("Cookie")
        return response

    def queue_cleanup(key):
        if key and db.session.get(Cleanup, key) is None:
            db.session.add(Cleanup(storage_key=key))

    def drain_cleanup(keys=None):
        # Queue rows share the metadata transaction and survive process restarts.
        query = Cleanup.query
        if keys is not None:
            if not keys:
                return 0
            query = query.filter(Cleanup.storage_key.in_(keys))
        pending = 0
        ordered = query.order_by(Cleanup.created_at, Cleanup.storage_key)
        if keys is None:
            ordered = ordered.limit(100)
        for item in ordered.all():
            try:
                # A referenced file must never be collected, even after a rollback.
                if Attachment.query.filter_by(storage_key=item.storage_key).first() is not None:
                    app.logger.error("Attachment cleanup category=still_referenced")
                    pending += 1
                    continue
                if not storage().delete_file(item.storage_key):
                    app.logger.warning("Attachment cleanup category=disk_file_missing")
                db.session.delete(item)
                db.session.commit()
            except (OSError, ValueError, SQLAlchemyError) as error:
                db.session.rollback()
                app.logger.error("Attachment cleanup category=%s; retry required", type(error).__name__)
                pending += 1
        return pending

    def rollback_uploads():
        for key in getattr(g, "attachment_new_keys", []):
            try:
                storage().delete_file(key)
            except (OSError, ValueError) as error:
                log_failure("rollback_cleanup", error)
                try:
                    queue_cleanup(key)
                    db.session.commit()
                except SQLAlchemyError as queue_error:
                    db.session.rollback()
                    log_failure("rollback_cleanup_queue", queue_error)
        g.attachment_new_keys = []

    def guarded(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            g.attachment_new_keys = []
            try:
                return view(*args, **kwargs)
            except AttachmentError as error:
                db.session.rollback()
                rollback_uploads()
                return error_response(error)
            except RequestEntityTooLarge:
                db.session.rollback()
                rollback_uploads()
                return error_response(too_large())
            except BadRequest:
                db.session.rollback()
                rollback_uploads()
                return error_response(AttachmentError("Invalid attachment request."))
            except (IntegrityError, StaleDataError) as error:
                db.session.rollback()
                rollback_uploads()
                log_failure("conflict", error)
                fingerprint = getattr(g, "attachment_fingerprint", None)
                if fingerprint and Attachment.query.filter_by(**fingerprint).first() is not None:
                    return error_response(duplicate_error())
                return error_response(AttachmentError("The attachment conflicts with an existing record. Refresh and retry.",
                                                      "ATTACHMENT_CONFLICT", 409))
            except (OSError, ValueError, SQLAlchemyError) as error:
                db.session.rollback()
                if isinstance(error, StorageWriteError):
                    g.attachment_new_keys.append(error.storage_key)
                rollback_uploads()
                log_failure("storage_or_database", error)
                return error_response(AttachmentError("The attachment operation could not be completed.",
                                                      "ATTACHMENT_OPERATION_FAILED", 500))
        return wrapped

    def managed_paper(paper_id):
        # PostgreSQL serializes mutations for a parent; SQLite also has unique constraints.
        paper = Paper.query.filter_by(id=paper_id).with_for_update().first()
        if paper is None:
            raise AttachmentError("Paper not found.", "PAPER_NOT_FOUND", 404)
        if not can_manage_paper(paper):
            raise AttachmentError("You do not have permission to edit this paper.", "PAPER_EDIT_FORBIDDEN", 403)
        return paper

    def published_paper(slug):
        paper = Paper.query.filter_by(slug=slug, status="published").first()
        if paper is None:
            raise AttachmentError("Paper not found.", "PAPER_NOT_FOUND", 404)
        return paper

    def attachment_for(paper, attachment_id):
        item = Attachment.query.filter_by(paper_id=paper.id, id=attachment_id).first()
        if item is None:
            raise AttachmentError("Attachment not found.", "ATTACHMENT_NOT_FOUND", 404)
        return item

    def serialize(item, paper, *, managed=False):
        result = {
            "id": item.id, "paperId": item.paper_id, "attachmentType": item.attachment_type,
            "displayName": item.display_name, "description": item.description,
            "mimeType": item.mime_type, "fileSize": item.file_size, "externalUrl": item.external_url,
            "accessLevel": item.access_level, "version": item.version, "sortOrder": item.sort_order,
            "createdAt": item.created_at.isoformat(), "updatedAt": item.updated_at.isoformat(),
            "downloadUrl": url_for("api_download_attachment", slug=paper.slug, attachment_id=item.id)
            if item.attachment_type != "external_link" else None,
        }
        if managed:
            result.update(originalFilename=item.original_filename, sha256=item.sha256,
                          uploadedBy={"id": item.uploaded_by.id, "username": item.uploaded_by.username,
                                      "role": item.uploaded_by.role})
        return result

    def read_payload(*, link=False):
        if link:
            if not request.is_json:
                raise AttachmentError("Request must be application/json.")
            return request.get_json(silent=True)
        if request.mimetype != "multipart/form-data":
            raise AttachmentError("Request must be multipart/form-data.")
        if set(request.files) != {"file"} or len(request.files.getlist("file")) != 1:
            raise AttachmentError("Exactly one file is required.")
        if any(len(request.form.getlist(key)) != 1 for key in request.form):
            raise AttachmentError("Duplicate form fields are not allowed.")
        return request.form.to_dict()

    def duplicate_error():
        return AttachmentError("This file is already attached to the paper.", "DUPLICATE_ATTACHMENT", 409)

    def save_upload(paper, values, *, existing=None):
        upload = request.files.get("file")
        metadata, extension = validate_file(upload, values["attachment_type"], app.config["ATTACHMENT_FILE_LIMITS"])
        fingerprint = {"paper_id": paper.id, "attachment_type": values["attachment_type"], "sha256": metadata["sha256"]}
        g.attachment_fingerprint = fingerprint
        query = Attachment.query.filter_by(**fingerprint)
        if existing:
            query = query.filter(Attachment.id != existing.id)
        if query.first() is not None or (existing and existing.sha256 == metadata["sha256"]):
            raise duplicate_error()
        if not existing and values["attachment_type"] in {"pdf", "cover"} and Attachment.query.filter_by(
            paper_id=paper.id, attachment_type=values["attachment_type"]
        ).first() is not None:
            raise AttachmentError("This paper already has this attachment type. Use the replace endpoint.",
                                  "PRIMARY_ATTACHMENT_EXISTS", 409)
        backend = storage()
        save = backend.replace_file if existing else backend.save_file
        key = save(upload.stream, paper.id, extension)
        g.attachment_new_keys.append(key)
        return {**metadata, "storage_key": key}

    def commit():
        db.session.commit()
        # Committed files are now referenced and must not be rollback-cleaned.
        g.attachment_new_keys = []

    @app.route("/api/papers/<int:paper_id>/attachments", methods=["POST"])
    @roles_required("teacher", "admin")
    @guarded
    def api_upload_attachment(paper_id):
        paper = managed_paper(paper_id)
        values = validate_metadata(read_payload())
        values.update(save_upload(paper, values))
        item = Attachment(paper_id=paper.id, uploaded_by_id=current_user.id, **values)
        db.session.add(item)
        commit()
        return jsonify({"attachment": serialize(item, paper, managed=True)}), 201

    @app.route("/api/papers/<int:paper_id>/attachments/link", methods=["POST"])
    @roles_required("teacher", "admin")
    @guarded
    def api_create_attachment_link(paper_id):
        paper = managed_paper(paper_id)
        values = validate_metadata(read_payload(link=True), link=True)
        item = Attachment(paper_id=paper.id, uploaded_by_id=current_user.id, **values)
        db.session.add(item)
        commit()
        return jsonify({"attachment": serialize(item, paper, managed=True)}), 201

    @app.route("/api/papers/manage/<int:paper_id>/attachments", methods=["GET"])
    @roles_required("teacher", "admin")
    @guarded
    def api_manage_attachments(paper_id):
        paper = managed_paper(paper_id)
        items = Attachment.query.filter_by(paper_id=paper.id).order_by(
            Attachment.sort_order, Attachment.created_at, Attachment.id
        ).all()
        return jsonify({"attachments": [serialize(item, paper, managed=True) for item in items]})

    @app.route("/api/papers/<string:slug>/attachments", methods=["GET"])
    @guarded
    def api_public_attachments(slug):
        paper = published_paper(slug)
        levels = ["public", "authenticated"] if current_user.is_authenticated else ["public"]
        items = Attachment.query.filter(Attachment.paper_id == paper.id, Attachment.access_level.in_(levels)).order_by(
            Attachment.sort_order, Attachment.created_at, Attachment.id
        ).all()
        return jsonify({"attachments": [serialize(item, paper) for item in items]})

    @app.route("/api/papers/<string:slug>/attachments/<int:attachment_id>/download", methods=["GET"])
    @guarded
    def api_download_attachment(slug, attachment_id):
        paper = published_paper(slug)
        item = attachment_for(paper, attachment_id)
        if item.access_level != "public" and not current_user.is_authenticated:
            raise AttachmentError("Authentication required.", "AUTH_REQUIRED", 401)
        if item.access_level == "staff" and current_user.role not in {"teacher", "admin"}:
            raise AttachmentError("You do not have permission to access this attachment.", "ATTACHMENT_ACCESS_DENIED", 403)
        if item.attachment_type == "external_link":
            raise AttachmentError("External links cannot be downloaded through this endpoint.", "ATTACHMENT_NOT_DOWNLOADABLE")
        try:
            stream = storage().open_file(item.storage_key)
        except FileNotFoundError:
            app.logger.warning("Attachment download attachment=%s paper=%s category=disk_file_missing", item.id, paper.id)
            raise AttachmentError("Attachment file not found.", "ATTACHMENT_NOT_FOUND", 404) from None
        try:
            response = send_file(stream, mimetype=item.mime_type,
                                 download_name=safe_filename(item.original_filename) or "attachment",
                                 as_attachment=item.attachment_type in {"slides", "document"} or request.args.get("download") == "1",
                                 conditional=False, etag=False, max_age=0)
            response.content_length = item.file_size
            response.call_on_close(stream.close)
            return response
        except Exception:
            stream.close()
            raise

    @app.route("/api/papers/<int:paper_id>/attachments/<int:attachment_id>", methods=["PUT"])
    @roles_required("teacher", "admin")
    @guarded
    def api_replace_attachment(paper_id, attachment_id):
        paper = managed_paper(paper_id)
        item = attachment_for(paper, attachment_id)
        link = item.attachment_type == "external_link"
        values = validate_metadata(read_payload(link=link), existing=item, link=link)
        old_key = item.storage_key
        if not link:
            values.update(save_upload(paper, values, existing=item))
        for name, value in values.items():
            setattr(item, name, value)
        item.version += 1
        item.uploaded_by_id = current_user.id
        if old_key:
            queue_cleanup(old_key)
        commit()
        result = {"attachment": serialize(item, paper, managed=True)}
        if drain_cleanup([old_key] if old_key else []):
            result["cleanupPending"] = True
        return jsonify(result)

    @app.route("/api/papers/<int:paper_id>/attachments/<int:attachment_id>", methods=["DELETE"])
    @roles_required("teacher", "admin")
    @guarded
    def api_delete_attachment(paper_id, attachment_id):
        paper = managed_paper(paper_id)
        item = attachment_for(paper, attachment_id)
        key = item.storage_key
        queue_cleanup(key)
        db.session.delete(item)
        commit()
        result = {"deleted": True, "attachmentId": attachment_id}
        if drain_cleanup([key] if key else []):
            result["cleanupPending"] = True
        return jsonify(result)

    @guarded
    def delete_paper(paper_id):
        paper = Paper.query.filter_by(id=paper_id).with_for_update().first()
        if paper is None:
            return paper_not_found_response()
        keys = [item.storage_key for item in paper.attachments if item.storage_key]
        for key in keys:
            queue_cleanup(key)
        db.session.delete(paper)
        commit()
        result = {"deleted": True, "paperId": paper_id}
        if drain_cleanup(keys):
            result["cleanupPending"] = True
        return jsonify(result), 200

    @app.cli.command("cleanup-attachment-files")
    def cleanup_attachment_files():
        """Retry up to 100 durable attachment file cleanup jobs."""
        drain_cleanup()
        remaining = Cleanup.query.count()
        click.echo(f"Pending attachment file cleanups: {remaining}")
        if remaining:
            raise click.ClickException("File cleanups remain pending; inspect server logs and retry.")

    return delete_paper
