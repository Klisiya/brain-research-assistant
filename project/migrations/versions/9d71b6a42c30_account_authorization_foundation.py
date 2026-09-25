"""account authorization foundation

Revision ID: 9d71b6a42c30
Revises: 6a3f4c2d91e0
"""
from alembic import op
import sqlalchemy as sa


revision = "9d71b6a42c30"
down_revision = "6a3f4c2d91e0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("user", sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("user", sa.Column("auth_version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("user", sa.Column("disabled_at", sa.DateTime(), nullable=True))
    op.add_column("user", sa.Column("last_login_at", sa.DateTime(), nullable=True))
    op.create_table("account_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    for column in ("actor_user_id", "target_user_id", "action", "created_at"):
        op.create_index(f"ix_account_audit_logs_{column}", "account_audit_logs", [column])


def downgrade():
    op.drop_table("account_audit_logs")
    # Native column drops preserve foreign keys from Papers to User on SQLite.
    for column in ("last_login_at", "disabled_at", "auth_version", "is_active"):
        op.drop_column("user", column)
