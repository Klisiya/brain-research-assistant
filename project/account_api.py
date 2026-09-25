"""Administrative account and audit endpoints."""
from functools import wraps
from math import ceil

from flask import current_app, jsonify, request
from flask_login import current_user
from sqlalchemy import func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from account_service import AUDIT_ACTIONS, AccountError, account_role, validate_role


def serialize_account(user):
    return {
        "id": user.id, "username": user.username, "email": user.email,
        "role": account_role(user.role), "isActive": user.is_active,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "lastLoginAt": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def query_integer(name, default=None, maximum=None):
    value = request.args.get(name)
    if value is None:
        return default
    try:
        number = int(value)
    except (ValueError, TypeError):
        number = 0
    if number < 1 or (maximum is not None and number > maximum):
        raise AccountError(f"Invalid {name}.", "VALIDATION_ERROR", 400)
    return number


def paginated(query):
    page = query_integer("page", 1, 1000000)
    per_page = query_integer("perPage", 20, 100)
    total = query.count()
    return query.offset((page - 1) * per_page).limit(per_page).all(), {
        "page": page, "perPage": per_page, "total": total, "totalPages": ceil(total / per_page),
    }


def register_account_api(app, db, User, Audit, service, roles_required):
    def guarded(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except AccountError as error:
                return jsonify({"error": str(error), "code": error.code}), error.status
            except SQLAlchemyError as error:
                db.session.rollback()
                current_app.logger.error("Account operation failed: %s", type(error).__name__)
                return jsonify({"error": "Account service is temporarily unavailable.", "code": "ACCOUNT_UNAVAILABLE"}), 503
        return wrapped

    @app.route("/api/admin/users", methods=["GET"])
    @roles_required("admin")
    @guarded
    def admin_users():
        query = User.query
        q = request.args.get("q", "").strip()
        if len(q) > 200:
            raise AccountError("Search must be at most 200 characters.", "VALIDATION_ERROR", 400)
        role = request.args.get("role")
        status = request.args.get("status")
        sort = request.args.get("sort", "newest")
        if q:
            query = query.filter(or_(func.lower(User.username).contains(q.lower(), autoescape=True),
                                     func.lower(User.email).contains(q.lower(), autoescape=True)))
        if role is not None:
            validate_role(role)
            query = query.filter(User.role.in_(["student", "user"]) if role == "student" else User.role == role)
        if status is not None:
            if status not in {"active", "disabled"}:
                raise AccountError("Status must be active or disabled.", "VALIDATION_ERROR", 400)
            query = query.filter(User.is_active.is_(status == "active"))
        sorts = {"newest": (User.created_at.desc(), User.id.desc()),
                 "oldest": (User.created_at.asc(), User.id.asc()),
                 "username": (func.lower(User.username).asc(), User.id.asc()),
                 "email": (func.lower(User.email).asc(), User.id.asc())}
        if sort not in sorts:
            raise AccountError("Invalid sort.", "VALIDATION_ERROR", 400)
        users, pagination = paginated(query.order_by(*sorts[sort]))
        return jsonify({"users": [serialize_account(user) for user in users], "pagination": pagination,
                        "filters": {"q": q, "role": role, "status": status, "sort": sort}})

    @app.route("/api/admin/users/<int:user_id>", methods=["GET"])
    @roles_required("admin")
    @guarded
    def admin_user(user_id):
        user = db.session.get(User, user_id)
        if user is None:
            raise AccountError("User not found.", "USER_NOT_FOUND", 404)
        return jsonify({"user": serialize_account(user)})

    def actor():
        return {"actor_id": current_user.id, "actor_version": current_user.auth_version}

    @app.route("/api/admin/users/<int:user_id>/role", methods=["PATCH"])
    @roles_required("admin")
    @guarded
    def admin_change_role(user_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {"role"}:
            raise AccountError("Provide only the role field.", "INVALID_ROLE", 400)
        user = service.change_role(user_id, payload["role"], **actor())
        return jsonify({"user": serialize_account(user)})

    @app.route("/api/admin/users/<int:user_id>/disable", methods=["POST"])
    @roles_required("admin")
    @guarded
    def admin_disable_user(user_id):
        return jsonify({"user": serialize_account(service.disable_user(user_id, **actor()))})

    @app.route("/api/admin/users/<int:user_id>/enable", methods=["POST"])
    @roles_required("admin")
    @guarded
    def admin_enable_user(user_id):
        return jsonify({"user": serialize_account(service.enable_user(user_id, **actor()))})

    @app.route("/api/admin/audit-logs", methods=["GET"])
    @roles_required("admin")
    @guarded
    def admin_audit_logs():
        query = Audit.query.options(joinedload(Audit.actor), joinedload(Audit.target))
        action = request.args.get("action")
        actor_id = query_integer("actorId")
        target_id = query_integer("targetId")
        if action is not None:
            if action not in AUDIT_ACTIONS:
                raise AccountError("Invalid audit action.", "VALIDATION_ERROR", 400)
            query = query.filter_by(action=action)
        if actor_id is not None:
            query = query.filter_by(actor_user_id=actor_id)
        if target_id is not None:
            query = query.filter_by(target_user_id=target_id)
        logs, pagination = paginated(query.order_by(Audit.created_at.desc(), Audit.id.desc()))
        def person(user):
            return {"id": user.id, "username": user.username} if user is not None else None
        return jsonify({"logs": [{
            "id": entry.id, "actor": person(entry.actor), "target": person(entry.target),
            "action": entry.action, "createdAt": entry.created_at.isoformat(),
            "details": {key: value for key, value in entry.details.items()
                        if key in {"oldRole", "newRole", "oldStatus", "newStatus"}},
        } for entry in logs], "pagination": pagination,
            "filters": {"action": action, "actorId": actor_id, "targetId": target_id}})
