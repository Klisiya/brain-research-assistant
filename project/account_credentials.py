"""Credential models; raw bearer tokens are never persisted here."""
from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def define_credentials(db):
    class Invitation(db.Model):
        __tablename__ = "account_invitations"
        id = db.Column(db.Integer, primary_key=True)
        email = db.Column(db.String(255), nullable=False, index=True)
        role = db.Column(db.String(50), nullable=False)
        token_hash = db.Column(db.String(64), nullable=False, unique=True)
        pending_email = db.Column(db.String(255), nullable=True, unique=True)
        created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
        expires_at = db.Column(db.DateTime, nullable=False)
        accepted_at = db.Column(db.DateTime)
        revoked_at = db.Column(db.DateTime)

    class PasswordResetToken(db.Model):
        __tablename__ = "password_reset_tokens"
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
        token_hash = db.Column(db.String(64), nullable=False, unique=True)
        auth_version = db.Column(db.Integer, nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
        expires_at = db.Column(db.DateTime, nullable=False)
        used_at = db.Column(db.DateTime)
        revoked_at = db.Column(db.DateTime)
    return Invitation, PasswordResetToken
