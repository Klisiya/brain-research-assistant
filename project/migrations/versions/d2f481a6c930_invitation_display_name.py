"""Retain an optional display name for imported invitations."""
from alembic import op
import sqlalchemy as sa
revision = "d2f481a6c930"
down_revision = "c83b9e4a1702"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("account_invitations", sa.Column("suggested_username", sa.String(80), nullable=True))


def downgrade():
    with op.batch_alter_table("account_invitations") as batch:
        batch.drop_column("suggested_username")
