"""Published course reads, scoped management reads and resource-authorized downloads."""
from functools import wraps
import click
from flask import jsonify, request, send_file, url_for
from flask_login import current_user
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload
from attachment_files import AttachmentError, safe_filename
from course_content import bootstrap_course
from module_readings import reading_rows


def register_course_api(app, db, Course, Module, Staff, CourseResource, ModuleResource, auth, roles_required, ModulePaper):
    assets = app.extensions["file_asset_service"]
    assets.register_resource("course", CourseResource, "course_id",
                             can_read=lambda parent, relation: isinstance(parent, Course) and auth.can_read_resource(parent, relation),
                             can_manage=auth.can_manage_course)
    assets.register_resource("module", ModuleResource, "module_id",
                             can_read=lambda parent, relation: isinstance(parent, Module) and auth.can_read_resource(parent, relation),
                             can_manage=auth.can_manage_module)

    def guarded(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            try:
                return view(*args, **kwargs)
            except AttachmentError as error:
                return jsonify(error=str(error), code=error.code), error.status
            except FileNotFoundError:
                return jsonify(error="Resource unavailable.", code="RESOURCE_NOT_FOUND"), 404
            except (SQLAlchemyError, OSError, ValueError) as error:
                db.session.rollback()
                app.logger.error("Course read failed category=%s", type(error).__name__)
                return jsonify(error="Course content is unavailable. Please try again.", code="COURSE_UNAVAILABLE"), 503
        return wrapped

    @app.after_request
    def course_headers(response):
        if request.path.startswith("/api/courses"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.vary.add("Cookie")
        return response

    def published_course(slug):
        course = Course.query.filter_by(slug=slug, status="published").first()
        if course is None:
            raise AttachmentError("Course not found.", "COURSE_NOT_FOUND", 404)
        return course

    def published_module(course, slug):
        module = Module.query.filter_by(course_id=course.id, slug=slug, status="published").first()
        if module is None:
            raise AttachmentError("Module not found.", "MODULE_NOT_FOUND", 404)
        return module

    def managed_course(course_id):
        course = db.session.get(Course, course_id)
        if course is None:
            raise AttachmentError("Course not found.", "COURSE_NOT_FOUND", 404)
        if not auth.can_manage_course(course):
            raise AttachmentError("Course management is not allowed.", "COURSE_MANAGE_FORBIDDEN", 403)
        return course

    def serialize_module(module, managed=False):
        item = {"id": module.id, "number": module.number, "slug": module.slug, "title": module.title,
                "titleZh": module.title_zh, "durationHours": module.duration_hours, "category": module.category,
                "description": module.description, "learningFocus": module.learning_focus, "coverVariant": module.cover_variant}
        if managed:
            item.update(status=module.status, createdAt=module.created_at.isoformat(), updatedAt=module.updated_at.isoformat())
        return item

    def serialize_course(course, *, include_modules=False, managed=False):
        modules = [m for m in course.modules if managed or m.status == "published"]
        item = {"id": course.id, "slug": course.slug, "title": course.title, "titleZh": course.title_zh,
                "description": course.description, "moduleCount": len(modules),
                "totalHours": sum(m.duration_hours for m in modules), "categories": list(dict.fromkeys(m.category for m in modules if m.category))}
        if include_modules:
            item["modules"] = [serialize_module(m, managed) for m in modules]
        if managed:
            item.update(status=course.status, createdAt=course.created_at.isoformat(), updatedAt=course.updated_at.isoformat())
        return item

    @app.get("/api/courses")
    @guarded
    def api_courses():
        courses = Course.query.options(selectinload(Course.modules)).filter_by(status="published").order_by(Course.id).all()
        return jsonify(courses=[serialize_course(c) for c in courses])

    @app.get("/api/courses/<slug>")
    @guarded
    def api_course(slug):
        return jsonify(course=serialize_course(published_course(slug), include_modules=True))

    @app.get("/api/courses/<slug>/modules")
    @guarded
    def api_course_modules(slug):
        course = published_course(slug)
        return jsonify(modules=[serialize_module(m) for m in course.modules if m.status == "published"])

    @app.get("/api/courses/<slug>/modules/<module_slug>")
    @guarded
    def api_course_module(slug, module_slug):
        course = published_course(slug)
        return jsonify(course=serialize_course(course), module=serialize_module(published_module(course, module_slug)))

    @app.get('/api/courses/<slug>/modules/<module_slug>/papers')
    @guarded
    def api_module_papers(slug, module_slug):
        module = published_module(published_course(slug), module_slug)
        return jsonify(readings=reading_rows(ModulePaper,module.id))

    @app.get("/api/courses/manage")
    @roles_required("teacher", "admin")
    @guarded
    def api_manage_courses():
        query = Course.query.options(selectinload(Course.modules))
        if current_user.role != "admin":
            query = query.join(Staff).filter(Staff.user_id == current_user.id)
        return jsonify(courses=[serialize_course(c, managed=True) for c in query.order_by(Course.id).all()])

    @app.get("/api/courses/<int:course_id>/manage")
    @roles_required("teacher", "admin")
    @guarded
    def api_manage_course(course_id):
        return jsonify(course=serialize_course(managed_course(course_id), include_modules=True, managed=True))

    @app.get("/api/courses/<int:course_id>/modules/<int:module_id>/manage")
    @roles_required("teacher", "admin")
    @guarded
    def api_manage_module(course_id, module_id):
        course = managed_course(course_id)
        module = Module.query.filter_by(id=module_id, course_id=course.id).first()
        if module is None:
            raise AttachmentError("Module not found.", "MODULE_NOT_FOUND", 404)
        return jsonify(course=serialize_course(course, managed=True), module=serialize_module(module, True))

    def resource_context(slug, module_slug):
        course = published_course(slug)
        if module_slug is None:
            return "course", course, CourseResource.query.filter_by(course_id=course.id)
        module = published_module(course, module_slug)
        return "module", module, ModuleResource.query.filter_by(module_id=module.id)

    @app.get("/api/courses/<slug>/resources", defaults={"module_slug": None})
    @app.get("/api/courses/<slug>/modules/<module_slug>/resources")
    @guarded
    def api_course_resources(slug, module_slug):
        kind, parent, query = resource_context(slug, module_slug)
        model = CourseResource if kind == "course" else ModuleResource
        items = []
        for relation in query.options(selectinload(model.asset)).order_by(model.sort_order, model.id).all():
            if relation.asset.asset_type == 'cover' or not auth.can_read_resource(parent, relation):
                continue
            asset = relation.asset
            items.append({"id": relation.id, "displayName": relation.display_name, "description": relation.description,
                          "attachmentType": asset.asset_type, "mimeType": asset.mime_type, "fileSize": asset.file_size,
                          "accessLevel": relation.access_level, "version": relation.version, "sortOrder": relation.sort_order,
                          "externalUrl": asset.external_url,
                          "downloadUrl": url_for("api_course_resource_download", slug=slug, module_slug=module_slug,
                                                 resource_id=relation.id) if asset.asset_type != "external_link" else None})
        return jsonify(resources=items)

    @app.get("/api/courses/<slug>/resources/<int:resource_id>/download", defaults={"module_slug": None})
    @app.get("/api/courses/<slug>/modules/<module_slug>/resources/<int:resource_id>/download")
    @guarded
    def api_course_resource_download(slug, module_slug, resource_id):
        kind, parent, query = resource_context(slug, module_slug)
        relation = query.filter_by(id=resource_id).first()
        if relation is None:
            raise AttachmentError("Resource not found.", "RESOURCE_NOT_FOUND", 404)
        stream = assets.open(kind, parent, relation)
        try:
            asset = relation.asset
            response = send_file(stream, mimetype=asset.mime_type, download_name=safe_filename(asset.original_filename) or "resource",
                                 as_attachment=True, conditional=False, etag=False, max_age=0)
            response.content_length = asset.file_size
            response.call_on_close(stream.close)
            return response
        except Exception:
            stream.close()
            raise

    @app.cli.command("bootstrap-course")
    def bootstrap_course_command():
        try:
            course, added = bootstrap_course(db, Course, Module)
            db.session.commit()
        except (ValueError, SQLAlchemyError) as error:
            db.session.rollback()
            raise click.ClickException("Unable to bootstrap course; existing content was not overwritten.") from error
        click.echo(f"Course {course.slug}; modules added: {added}.")
