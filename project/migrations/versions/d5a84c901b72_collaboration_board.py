"""Add only collaboration fields and audited business transitions; no content seeds."""
from alembic import op
import sqlalchemy as sa

revision = 'd5a84c901b72'
down_revision = 'c491e8d62a70'
branch_labels = None
depends_on = None
old_actions = "'created','edited','draft_created','submitted','withdrawn','approved','rejected','archived','attachment_added','attachment_removed'"


def event_sequence():
    bind = op.get_bind()
    if bind.dialect.name == 'sqlite':
        return bind.execute(sa.text("SELECT seq FROM sqlite_sequence WHERE name='hub_moderation_events'")).scalar() or 0
    return None


def preserve_event_sequence(previous):
    if previous is not None:
        op.get_bind().execute(sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:previous) WHERE name='hub_moderation_events'"), {'previous': previous})


def upgrade():
    previous_sequence = event_sequence()
    op.add_column('hub_entries', sa.Column('collaboration_status', sa.String(12)))
    for name, kind in [('requirements', sa.Text()), ('deadline', sa.Date()),
                       ('contact_name', sa.String(200)), ('contact_email', sa.String(254))]:
        op.add_column('hub_revisions', sa.Column(name, kind))
    with op.batch_alter_table('hub_moderation_events', table_kwargs={'sqlite_autoincrement': True}) as batch:
        batch.drop_constraint('ck_hub_event_action', type_='check')
        batch.create_check_constraint('ck_hub_event_action', f"action IN ({old_actions},'closed','reopened')")
    preserve_event_sequence(previous_sequence)


def downgrade():
    previous_sequence = event_sequence()
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT COUNT(*) FROM hub_entries WHERE kind='collaboration' OR collaboration_status IS NOT NULL")).scalar() or bind.execute(sa.text("SELECT COUNT(*) FROM hub_revisions WHERE requirements IS NOT NULL OR deadline IS NOT NULL OR contact_name IS NOT NULL OR contact_email IS NOT NULL")).scalar() or bind.execute(sa.text("SELECT COUNT(*) FROM hub_moderation_events WHERE action IN ('closed','reopened')")).scalar():
        raise RuntimeError('Cannot discard collaboration content or audit history; preserve it first.')
    with op.batch_alter_table('hub_moderation_events', table_kwargs={'sqlite_autoincrement': True}) as batch:
        batch.drop_constraint('ck_hub_event_action', type_='check')
        batch.create_check_constraint('ck_hub_event_action', f"action IN ({old_actions})")
    preserve_event_sequence(previous_sequence)
    for name in ['contact_email', 'contact_name', 'deadline', 'requirements']:
        op.drop_column('hub_revisions', name)
    op.drop_column('hub_entries', 'collaboration_status')
