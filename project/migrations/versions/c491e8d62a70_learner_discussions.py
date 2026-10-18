"""Add flat discussion relationships and private reports; no discussion seeds."""
from alembic import op
import sqlalchemy as sa

revision = 'c491e8d62a70'
down_revision = 'b3d970ef624a'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('hub_discussions',
        sa.Column('entry_id', sa.Integer(), sa.ForeignKey('hub_entries.id', ondelete='RESTRICT'), primary_key=True),
        sa.Column('thread_id', sa.Integer(), sa.ForeignKey('hub_entries.id', ondelete='RESTRICT')),
        sa.CheckConstraint('thread_id IS NULL OR thread_id != entry_id', name='ck_discussion_parent'))
    op.create_index('ix_hub_discussions_thread_id', 'hub_discussions', ['thread_id'])
    op.create_table('hub_reports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('target_entry_id', sa.Integer(), sa.ForeignKey('hub_entries.id', ondelete='RESTRICT')),
        sa.Column('original_target_id', sa.Integer(), nullable=False),
        sa.Column('target_type', sa.String(10), nullable=False),
        sa.Column('reporter_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('reason', sa.String(200), nullable=False), sa.Column('detail', sa.String(2000)),
        sa.Column('status', sa.String(12), nullable=False), sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('resolved_at', sa.DateTime()),
        sa.Column('resolved_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT')),
        sa.CheckConstraint("target_type IN ('thread','reply')", name='ck_hub_report_type'),
        sa.CheckConstraint("status IN ('open','resolved','dismissed')", name='ck_hub_report_status'),
        sa.CheckConstraint('version >= 1', name='ck_hub_report_version'), sqlite_autoincrement=True)
    op.create_index('ix_hub_reports_target_entry_id', 'hub_reports', ['target_entry_id'])
    op.create_index('ix_hub_reports_status', 'hub_reports', ['status'])
    op.create_table('hub_report_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('report_id', sa.Integer(), sa.ForeignKey('hub_reports.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('action', sa.String(20), nullable=False), sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("action IN ('reported','resolved','dismissed','target_deleted')", name='ck_report_event_action'))
    op.create_index('ix_hub_report_events_report_id', 'hub_report_events', ['report_id'])


def downgrade():
    for table in ['hub_discussions','hub_reports','hub_report_events']:
        if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM '+table)).scalar():
            raise RuntimeError('Cannot discard nonempty discussions or governance records; preserve them first.')
    op.drop_table('hub_report_events')
    op.drop_table('hub_reports')
    op.drop_table('hub_discussions')
