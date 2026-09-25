"""add paper citation metadata

Revision ID: 6a3f4c2d91e0
Revises: b78b852aa4b4
"""
from alembic import op
import sqlalchemy as sa


revision = "6a3f4c2d91e0"
down_revision = "b78b852aa4b4"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("papers") as batch_op:
        batch_op.add_column(sa.Column("doi", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("volume", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("issue", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("pages", sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column("publisher", sa.String(length=300), nullable=True))


def downgrade():
    with op.batch_alter_table("papers") as batch_op:
        batch_op.drop_column("publisher")
        batch_op.drop_column("pages")
        batch_op.drop_column("issue")
        batch_op.drop_column("volume")
        batch_op.drop_column("doi")
