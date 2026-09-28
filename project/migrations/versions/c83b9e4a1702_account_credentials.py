"""Add invitation and password reset credentials.

Revision ID: c83b9e4a1702
Revises: 9d71b6a42c30
"""
from alembic import op
import sqlalchemy as sa
revision = "c83b9e4a1702"
down_revision = "9d71b6a42c30"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("account_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("pending_email", sa.String(255), nullable=True, unique=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("accepted_at", sa.DateTime()), sa.Column("revoked_at", sa.DateTime()))
    op.create_index("ix_account_invitations_email", "account_invitations", ["email"])
    op.create_table("password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime()), sa.Column("revoked_at", sa.DateTime()))
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])


def downgrade():
    op.drop_table("password_reset_tokens")
    op.drop_table("account_invitations")
