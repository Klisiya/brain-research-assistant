"""Invitation and password HTTP contracts."""
from functools import wraps
from flask import jsonify, request
from urllib.parse import urlparse
from flask_login import current_user
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from account_service import AccountError
from account_api import paginated

FORGOT_MESSAGE = "If an account exists for this email, a reset link has been sent."


def register_lifecycle_api(app, db, Invitation, service, roles_required):
    def guarded(fn):
        @wraps(fn)
        def call(*args, **kwargs):
            try:
                origin = request.headers.get("Origin")
                frontend = urlparse(app.config.get("FRONTEND_URL", "http://127.0.0.1:5173"))
                allowed = {request.host_url.rstrip("/"), f"{frontend.scheme}://{frontend.netloc}"}
                if request.method != "GET" and ((origin and origin not in allowed) or request.headers.get("Sec-Fetch-Site") == "cross-site"):
                    raise AccountError("Request origin is not allowed.", "CSRF_ORIGIN_DENIED", 403)
                return fn(*args, **kwargs)
            except AccountError as error:
                return jsonify(error=str(error), code=error.code), error.status
            except IntegrityError:
                db.session.rollback()
                return jsonify(error="The account request conflicts with an existing record.", code="ACCOUNT_CONFLICT"), 409
            except SQLAlchemyError:
                db.session.rollback()
                return jsonify(error="Account service is temporarily unavailable.", code="ACCOUNT_UNAVAILABLE"), 503
        return call

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict): raise AccountError("A JSON object is required.", "VALIDATION_ERROR", 400)
        return value

    def password(data):
        value = data.get("password")
        if value != data.get("confirmPassword"):
            raise AccountError("Passwords must match.", "PASSWORD_INVALID", 400)
        return value

    def serialize(entry):
        return dict(id=entry.id, email=entry.email, role=entry.role, createdAt=entry.created_at.isoformat(),
                    expiresAt=entry.expires_at.isoformat(), status=service.invitation_status(entry))

    @app.route("/api/admin/invitations", methods=["POST"])
    @roles_required("admin")
    @guarded
    def create_invitation():
        data = payload()
        entry = service.invite(data.get("email"), data.get("role"), current_user.id, current_user.auth_version)
        return jsonify(invitation=serialize(entry)), 201

    @app.route("/api/admin/invitations", methods=["GET"])
    @roles_required("admin")
    @guarded
    def invitations():
        rows, pagination = paginated(Invitation.query.order_by(Invitation.created_at.desc(), Invitation.id.desc()))
        return jsonify(invitations=[serialize(row) for row in rows], pagination=pagination)

    @app.route("/api/admin/invitations/<int:invitation_id>/revoke", methods=["POST"])
    @roles_required("admin")
    @guarded
    def revoke(invitation_id):
        return jsonify(invitation=serialize(service.revoke_invitation(invitation_id, current_user.id, current_user.auth_version)))

    @app.route("/api/auth/accept-invitation", methods=["POST"])
    @guarded
    def accept():
        data = payload()
        service.accept(data.get("token"), data.get("username"), password(data))
        return jsonify(message="Account created. Please sign in."), 201

    @app.route("/api/auth/forgot-password", methods=["POST"])
    @guarded
    def forgot():
        data = payload()
        try: service.request_reset(email=data.get("email"))
        except (AccountError, SQLAlchemyError):
            # Delivery/configuration failures must not disclose whether an account exists.
            app.logger.warning("Password recovery request could not be delivered.")
        return jsonify(message=FORGOT_MESSAGE)

    @app.route("/api/admin/users/<int:user_id>/password-reset", methods=["POST"])
    @roles_required("admin")
    @guarded
    def admin_reset(user_id):
        service.request_reset(actor_id=current_user.id, actor_version=current_user.auth_version, target_id=user_id)
        return jsonify(message="Password reset link sent.")

    @app.route("/api/auth/reset-password", methods=["POST"])
    @guarded
    def reset():
        data = payload()
        service.reset(data.get("token"), password(data))
        return jsonify(message="Password reset. Please sign in.")

    @app.route("/api/auth/change-password", methods=["POST"])
    @roles_required()
    @guarded
    def change():
        data = payload()
        service.change_password(current_user.id, current_user.auth_version, data.get("currentPassword"), password(data))
        return jsonify(message="Password changed. Please sign in again.")
