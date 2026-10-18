"""Independent deletion receipts; existing content tables remain unchanged."""
from alembic import op
import sqlalchemy as sa

revision = 'b3d970ef624a'
down_revision = 'a27e6b904c15'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('hub_deletion_audits',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('original_entry_id', sa.Integer(), nullable=False, unique=True),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sqlite_autoincrement=True)


def downgrade():
    if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM hub_deletion_audits')).scalar():
        raise RuntimeError('Cannot discard deletion audit receipts; preserve them first.')
    op.drop_table('hub_deletion_audits')
