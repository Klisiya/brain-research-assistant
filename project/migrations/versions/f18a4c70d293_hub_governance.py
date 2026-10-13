"""Add Hub governance only; keep all existing content and learning rows."""
from alembic import op
import sqlalchemy as sa

revision = 'f18a4c70d293'
down_revision = 'e63a9d20bf17'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('hub_entries',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(30), nullable=False),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('published_revision_id', sa.Integer()), sa.Column('working_revision_id', sa.Integer()),
        sa.Column('archived_at', sa.DateTime()), sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False), sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('faculty','industry','discussions','collaboration')", name='ck_hub_kind'),
        sa.CheckConstraint('version >= 1', name='ck_hub_version'), sqlite_autoincrement=True)
    op.create_index('ix_hub_entries_owner_id', 'hub_entries', ['owner_id'])
    op.create_table('hub_revisions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('entry_id', sa.Integer(), sa.ForeignKey('hub_entries.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False), sa.Column('state', sa.String(20), nullable=False),
        sa.Column('title', sa.String(200), nullable=False), sa.Column('body', sa.Text(), nullable=False),
        sa.Column('source_name', sa.String(300)), sa.Column('source_url', sa.String(1500)),
        sa.Column('submitted_at', sa.DateTime()), sa.Column('reviewed_at', sa.DateTime()),
        sa.Column('reviewed_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT')),
        sa.Column('review_note', sa.String(2000)), sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('entry_id','number', name='uq_hub_revision_number'),
        sa.CheckConstraint("state IN ('draft','pending','approved','rejected')", name='ck_hub_revision_state'),
        sa.CheckConstraint('number >= 1', name='ck_hub_revision_number'),
        sa.CheckConstraint('length(title) BETWEEN 1 AND 200 AND length(body) <= 10000', name='ck_hub_text'), sqlite_autoincrement=True)
    op.create_index('ix_hub_revisions_entry_id', 'hub_revisions', ['entry_id'])
    op.create_index('ix_hub_revisions_state', 'hub_revisions', ['state'])
    op.create_table('hub_attachments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('revision_id', sa.Integer(), sa.ForeignKey('hub_revisions.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('asset_id', sa.Integer(), sa.ForeignKey('file_assets.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('display_name', sa.String(300), nullable=False), sqlite_autoincrement=True)
    op.create_index('ix_hub_attachments_revision_id', 'hub_attachments', ['revision_id'])
    op.create_index('ix_hub_attachments_asset_id', 'hub_attachments', ['asset_id'])
    op.create_table('hub_moderation_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('entry_id', sa.Integer(), sa.ForeignKey('hub_entries.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('revision_id', sa.Integer(), sa.ForeignKey('hub_revisions.id', ondelete='RESTRICT')),
        sa.Column('actor_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('action', sa.String(40), nullable=False), sa.Column('note', sa.String(2000)),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint("action IN ('created','edited','draft_created','submitted','withdrawn','approved','rejected','archived','attachment_added','attachment_removed')", name='ck_hub_event_action'), sqlite_autoincrement=True)
    op.create_index('ix_hub_moderation_events_entry_id', 'hub_moderation_events', ['entry_id'])


def downgrade():
    tables = ['hub_moderation_events','hub_attachments','hub_revisions','hub_entries']
    for table in tables:
        if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM ' + table)).scalar():
            raise RuntimeError('Cannot downgrade nonempty Hub content or moderation history; preserve it first.')
    for table in tables:
        op.drop_table(table)
