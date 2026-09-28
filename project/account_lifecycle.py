"""Atomic invitation and password operations using the existing account boundary."""
from contextlib import contextmanager
from datetime import timedelta
from account_credentials import utc_now
import hashlib
import re
import secrets
from urllib.parse import urlencode, urlparse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from account_service import AccountError, AccountService, validate_role


def validate_password(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 512:
        raise AccountError("Use a password between 12 and 512 characters.", "PASSWORD_INVALID", 400)
    return password


def email_address(value):
    if not isinstance(value, str) or len(value.strip()) > 255 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value.strip()):
        raise AccountError("Enter a valid email address.", "VALIDATION_ERROR", 400)
    return value.strip().lower()


def digest(token):
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    return hashlib.sha256(token.encode("ascii")).hexdigest()


class AccountLifecycleService(AccountService):
    def __init__(self, db, User, Audit, Invitation, Reset, mail, app):
        super().__init__(db, User, Audit)
        self.Invitation, self.Reset, self.mail, self.app = Invitation, Reset, mail, app

    @contextmanager
    def transaction(self):
        with Session(self.db.engine, expire_on_commit=False) as tx:
            if self.db.engine.dialect.name == "sqlite":
                tx.connection().exec_driver_sql("BEGIN IMMEDIATE")
            yield tx
            tx.commit()

    def actor(self, tx, uid, version, admin=False):
        user = tx.scalar(select(self.User).where(self.User.id == uid).with_for_update())
        if user is None or not user.is_active or user.auth_version != version:
            raise AccountError("Authentication required.", "AUTH_REQUIRED", 401)
        if admin and user.role != "admin":
            raise AccountError("Administrator access required.", "ACCESS_DENIED", 403)
        return user

    def audit(self, tx, action, target, actor=None, **details):
        tx.add(self.Audit(action=action, target_user_id=target, actor_user_id=actor, details=details))

    def link(self, path, token):
        base = self.app.config.get("FRONTEND_URL") or "http://127.0.0.1:5173"
        parsed = urlparse(base)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise AccountError("Email delivery is unavailable.", "MAIL_UNAVAILABLE", 503)
        return base.rstrip("/") + path + "?" + urlencode({"token": token})

    def invite(self, email, role, uid, version, username=None):
        email, role = email_address(email), validate_role(role)
        if username is not None and (not isinstance(username, str) or not 1 <= len(username.strip()) <= 80):
            raise AccountError("Use a name between 1 and 80 characters.", "VALIDATION_ERROR", 400)
        now = utc_now()
        with self.transaction() as tx:
            self.actor(tx, uid, version, True)
            if tx.scalar(select(self.User.id).where(func.lower(self.User.email) == email)):
                raise AccountError("An account already uses this email.", "EMAIL_ALREADY_EXISTS", 409)
            old = tx.scalars(select(self.Invitation).where(self.Invitation.pending_email == email).with_for_update()).all()
            for entry in old:
                if entry.expires_at > now:
                    raise AccountError("A pending invitation already exists.", "INVITATION_PENDING", 409)
                entry.pending_email = None
            tx.flush()
            token = secrets.token_urlsafe(32)
            entry = self.Invitation(email=email, role=role, token_hash=digest(token), pending_email=email,
                                    created_by_id=uid, expires_at=now + timedelta(hours=48),
                                    suggested_username=username.strip() if username else None)
            tx.add(entry); tx.flush()
            self.audit(tx, "invitation_created", uid, uid, invitationId=entry.id)
            self.mail.send(email, "Account invitation", self.link("/accept-invitation", token))
            return entry

    def invitation_status(self, entry):
        if entry.accepted_at: return "Accepted"
        if entry.revoked_at: return "Revoked"
        if entry.expires_at <= utc_now(): return "Expired"
        return "Pending"

    def revoke_invitation(self, invitation_id, uid, version):
        with self.transaction() as tx:
            self.actor(tx, uid, version, True)
            entry = tx.scalar(select(self.Invitation).where(self.Invitation.id == invitation_id).with_for_update())
            if entry is None:
                raise AccountError("Invitation is invalid.", "INVITATION_INVALID", 404)
            if entry.accepted_at:
                raise AccountError("Invitation has already been accepted.", "INVITATION_USED", 409)
            if not entry.revoked_at:
                entry.revoked_at = utc_now(); entry.pending_email = None
                self.audit(tx, "invitation_revoked", uid, uid, invitationId=entry.id)
            return entry

    def credential(self, tx, model, token, prefix):
        hashed = digest(token)
        entry = tx.scalar(select(model).where(model.token_hash == hashed).with_for_update()) if hashed else None
        if entry is None:
            raise AccountError("This link is invalid.", prefix + "_INVALID", 400)
        if getattr(entry, "accepted_at", None) or getattr(entry, "used_at", None):
            raise AccountError("This link has already been used.", prefix + "_USED", 409)
        if entry.revoked_at:
            raise AccountError("This link has been revoked.", prefix + "_REVOKED", 400)
        if entry.expires_at <= utc_now():
            raise AccountError("This link has expired.", prefix + "_EXPIRED", 400)
        return entry

    def accept(self, token, username, password):
        validate_password(password)
        if not isinstance(username, str) or not 1 <= len(username.strip()) <= 80:
            raise AccountError("Use a name between 1 and 80 characters.", "VALIDATION_ERROR", 400)
        with self.transaction() as tx:
            entry = self.credential(tx, self.Invitation, token, "INVITATION")
            if tx.scalar(select(self.User.id).where(func.lower(self.User.email) == entry.email)):
                raise AccountError("An account already uses this email.", "EMAIL_ALREADY_EXISTS", 409)
            user = self.User(username=username.strip(), email=entry.email, role=entry.role, is_active=True, auth_version=1)
            user.set_password(password)
            tx.add(user); tx.flush()
            entry.accepted_at = utc_now(); entry.pending_email = None
            self.audit(tx, "invitation_accepted", user.id, invitationId=entry.id)
            return user

    def revoke_resets(self, tx, uid):
        for entry in tx.scalars(select(self.Reset).where(self.Reset.user_id == uid, self.Reset.used_at.is_(None), self.Reset.revoked_at.is_(None)).with_for_update()):
            entry.revoked_at = utc_now()

    def request_reset(self, email=None, actor_id=None, actor_version=None, target_id=None):
        if target_id is None: email = email_address(email)
        with self.transaction() as tx:
            if actor_id is not None: self.actor(tx, actor_id, actor_version, True)
            query = select(self.User).where(self.User.id == target_id) if target_id is not None else select(self.User).where(func.lower(self.User.email) == email)
            user = tx.scalar(query.with_for_update())
            if user is None or not user.is_active:
                if actor_id is not None:
                    raise AccountError("An active account is required.", "USER_NOT_FOUND", 404)
                return
            self.revoke_resets(tx, user.id)
            token = secrets.token_urlsafe(32)
            tx.add(self.Reset(user_id=user.id, auth_version=user.auth_version, token_hash=digest(token), expires_at=utc_now() + timedelta(minutes=30)))
            self.audit(tx, "password_reset_requested", user.id, actor_id)
            self.mail.send(user.email, "Password reset", self.link("/reset-password", token))

    def reset(self, token, password):
        validate_password(password)
        with self.transaction() as tx:
            hashed = digest(token)
            candidate = tx.scalar(select(self.Reset).where(self.Reset.token_hash == hashed)) if hashed else None
            if candidate is None:
                raise AccountError("This link is invalid.", "RESET_TOKEN_INVALID", 400)
            user = tx.scalar(select(self.User).where(self.User.id == candidate.user_id).with_for_update())
            entry = self.credential(tx, self.Reset, token, "RESET_TOKEN")
            if user is None or not user.is_active or user.auth_version != entry.auth_version:
                raise AccountError("This link is invalid.", "RESET_TOKEN_INVALID", 400)
            user.set_password(password)
            entry.used_at = utc_now()
            self.revoke_resets(tx, user.id)
            self.audit(tx, "password_reset_completed", user.id)

    def change_password(self, uid, version, current, password):
        validate_password(password)
        if not isinstance(current, str) or not current or len(current) > 512:
            raise AccountError("Current password is required.", "CURRENT_PASSWORD_INVALID", 400)
        with self.transaction() as tx:
            user = self.actor(tx, uid, version)
            if not user.check_password(current):
                raise AccountError("Current password is incorrect.", "CURRENT_PASSWORD_INVALID", 400)
            user.set_password(password)
            self.revoke_resets(tx, user.id)
            self.audit(tx, "password_changed", user.id, user.id)
