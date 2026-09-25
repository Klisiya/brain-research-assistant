"""Atomic account changes shared by administrative HTTP and CLI entry points."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session


ACCOUNT_ROLES = {"student", "teacher", "admin"}
AUDIT_ACTIONS = {"role_changed", "account_disabled", "account_enabled"}


def account_role(role):
    return "student" if role == "user" else role


class AccountError(ValueError):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.code = code
        self.status = status


def validate_role(role):
    if not isinstance(role, str) or role not in ACCOUNT_ROLES:
        raise AccountError("Role must be student, teacher, or admin.", "INVALID_ROLE", 400)
    return role


class AccountService:
    def __init__(self, db, user_model, audit_model):
        self.db = db
        self.User = user_model
        self.Audit = audit_model

    def change_role(self, user_id, role, *, actor_id=None, actor_version=None):
        return self._change(user_id, "role", validate_role(role), actor_id, actor_version)

    def disable_user(self, user_id, *, actor_id=None, actor_version=None):
        return self._change(user_id, "disable", None, actor_id, actor_version)

    def enable_user(self, user_id, *, actor_id=None, actor_version=None):
        return self._change(user_id, "enable", None, actor_id, actor_version)

    def _change(self, user_id, operation, role, actor_id, actor_version):
        User = self.User
        # A separate transaction rechecks the actor after acquiring the write lock.
        with Session(self.db.engine, expire_on_commit=False) as transaction:
            if self.db.engine.dialect.name == "sqlite":
                transaction.connection().exec_driver_sql("BEGIN IMMEDIATE")
            else:
                transaction.scalars(select(User).where(
                    User.role == "admin", User.is_active.is_(True),
                ).order_by(User.id).with_for_update()).all()

            if actor_id is not None:
                actor = transaction.get(User, actor_id)
                if actor is None or not actor.is_active or actor.auth_version != actor_version:
                    raise AccountError("Authentication required.", "AUTH_REQUIRED", 401)
                if actor.role != "admin":
                    raise AccountError("You do not have permission to perform this action.", "ACCESS_DENIED", 403)

            user = transaction.get(User, user_id)
            if user is None:
                raise AccountError("User not found.", "USER_NOT_FOUND", 404)

            changes_role = operation == "role" and account_role(user.role) != role
            changes_status = (operation == "disable" and user.is_active) or (operation == "enable" and not user.is_active)
            if not changes_role and not changes_status:
                transaction.commit()
                return user

            removes_admin = user.role == "admin" and user.is_active and (
                operation == "disable" or (changes_role and role != "admin")
            )
            if removes_admin:
                active_admins = transaction.scalar(select(func.count()).select_from(User).where(
                    User.role == "admin", User.is_active.is_(True),
                ))
                if active_admins <= 1:
                    raise AccountError("At least one active administrator must remain.", "LAST_ACTIVE_ADMIN", 409)

            if changes_role:
                action = "role_changed"
                details = {"oldRole": account_role(user.role), "newRole": role}
                user.role = role
            else:
                active = operation == "enable"
                action = "account_enabled" if active else "account_disabled"
                details = {"oldStatus": "active" if user.is_active else "disabled",
                           "newStatus": "active" if active else "disabled"}
                user.is_active = active
                user.disabled_at = None if active else datetime.utcnow()

            user.auth_version += 1
            transaction.add(self.Audit(actor_user_id=actor_id, target_user_id=user.id,
                                       action=action, details=details))
            transaction.commit()
            return user
