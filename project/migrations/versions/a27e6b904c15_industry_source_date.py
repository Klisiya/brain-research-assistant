"""Add optional, revision-scoped source date; never seed Industry Updates."""
from alembic import op
import sqlalchemy as sa

revision = 'a27e6b904c15'
down_revision = 'f18a4c70d293'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hub_revisions', sa.Column('source_date', sa.Date(), nullable=True))


def downgrade():
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM hub_revisions WHERE source_date IS NOT NULL')).scalar():
        raise RuntimeError('Cannot discard existing Industry source dates; preserve them first.')
    op.drop_column('hub_revisions', 'source_date')
