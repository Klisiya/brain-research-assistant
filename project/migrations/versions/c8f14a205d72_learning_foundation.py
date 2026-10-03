"""Private enrollment and version-aware self-reported learning; no data seeds."""
from alembic import op
import sqlalchemy as sa

revision = 'c8f14a205d72'
down_revision = 'b9e27f104c63'
branch_labels = None
depends_on = None


def index(table, *columns):
    for column in columns:
        op.create_index(f'ix_{table}_{column}', table, [column])


def upgrade():
    op.create_table('learning_enrollments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('courses.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('completion_rule_version', sa.Integer(), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(), nullable=False),
        sa.Column('last_activity_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'course_id', name='uq_learning_enrollment'),
        sa.CheckConstraint("state = 'active'", name='ck_learning_enrollment_state'),
        sa.CheckConstraint('completion_rule_version >= 1', name='ck_learning_rule_version'))
    index('learning_enrollments', 'user_id', 'course_id')
    op.create_table('learning_module_progress',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('enrollment_id', sa.Integer(), sa.ForeignKey('learning_enrollments.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('module_id', sa.Integer(), sa.ForeignKey('course_modules.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('started_at', sa.DateTime()), sa.Column('last_activity_at', sa.DateTime()),
        sa.Column('self_completed_at', sa.DateTime()), sa.Column('verified_completed_at', sa.DateTime()),
        sa.UniqueConstraint('enrollment_id', 'module_id', name='uq_learning_module'))
    index('learning_module_progress', 'enrollment_id', 'module_id')
    for kind in ['course', 'module']:
        table, prefix = f'learning_{kind}_resource_progress', f'learning_{kind}_resource'
        op.create_table(table,
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('enrollment_id', sa.Integer(), sa.ForeignKey('learning_enrollments.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('resource_id', sa.Integer(), sa.ForeignKey(f'{kind}_resources.id', ondelete='SET NULL')),
            sa.Column('relation_id_at_recording', sa.Integer(), nullable=False),
            sa.Column('resource_version', sa.Integer(), nullable=False),
            sa.Column('started_at', sa.DateTime(), nullable=False), sa.Column('last_activity_at', sa.DateTime(), nullable=False),
            sa.Column('self_completed_at', sa.DateTime()),
            sa.UniqueConstraint('enrollment_id', 'resource_id', 'resource_version', name=f'uq_{prefix}'),
            sa.CheckConstraint('resource_version >= 1', name=f'ck_{prefix}_version'),
            sa.CheckConstraint('relation_id_at_recording > 0 AND (resource_id IS NULL OR resource_id = relation_id_at_recording)', name=f'ck_{prefix}_identity'))
        index(table, 'enrollment_id', 'resource_id')


def downgrade():
    tables = ['learning_module_resource_progress', 'learning_course_resource_progress', 'learning_module_progress', 'learning_enrollments']
    for name in tables:
        table = sa.table(name, sa.column('id'))
        if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar():
            raise RuntimeError('Cannot downgrade nonempty learning history; preserve personal records first.')
    for name in tables:
        op.drop_table(name)
