"""Restore a confirmed pre-upgrade audit ID high-water mark without changing rows.

Fresh upgrades already preserve it in d5a84c901b72. A database upgraded with the
original migration may supply R8A4_EVENT_SEQUENCE_FLOOR from its verified backup.
No content, identity, publication pointer or audit record is created or modified.
"""
import os
from alembic import op
import sqlalchemy as sa

revision = 'e6b25c14d930'
down_revision = 'd5a84c901b72'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        return
    supplied = os.environ.get('R8A4_EVENT_SEQUENCE_FLOOR', '0')
    if not supplied.isascii() or not supplied.isdecimal() or not 0 <= int(supplied) <= 9223372036854775807:
        raise RuntimeError('Audit sequence floor must be a verified nonnegative SQLite integer.')
    current = bind.execute(sa.text("SELECT seq FROM sqlite_sequence WHERE name='hub_moderation_events'")).scalar()
    maximum = bind.execute(sa.text('SELECT MAX(id) FROM hub_moderation_events')).scalar() or 0
    value = max(current or 0, maximum, int(supplied))
    if current is None:
        bind.execute(sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES('hub_moderation_events',:value)"), {'value': value})
    else:
        bind.execute(sa.text("UPDATE sqlite_sequence SET seq=:value WHERE name='hub_moderation_events'"), {'value': value})


def downgrade():
    # Never decrease an issued audit ID high-water mark on downgrade.
    pass
