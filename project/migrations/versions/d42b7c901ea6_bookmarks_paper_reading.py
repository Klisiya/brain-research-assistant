"""Add personal bookmarks and version-aware paper reading without seeds."""
from alembic import op
import sqlalchemy as sa

revision = 'd42b7c901ea6'
down_revision = 'c8f14a205d72'
branch_labels = None
depends_on = None


def indexes(table, *columns):
    for column in columns:
        op.create_index(f'ix_{table}_{column}', table, [column])


def upgrade():
    fields = [('paper_id','papers'), ('course_id','courses'), ('module_id','course_modules'), ('research_area_id','research_areas')]
    op.create_table('learning_bookmarks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False),
        *(sa.Column(column, sa.Integer(), sa.ForeignKey(table+'.id', ondelete='CASCADE')) for column, table in fields),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        *(sa.UniqueConstraint('user_id', column, name=f'uq_bookmark_{column}') for column, _ in fields),
        sa.CheckConstraint('(CASE WHEN paper_id IS NULL THEN 0 ELSE 1 END + CASE WHEN course_id IS NULL THEN 0 ELSE 1 END + CASE WHEN module_id IS NULL THEN 0 ELSE 1 END + CASE WHEN research_area_id IS NULL THEN 0 ELSE 1 END) = 1', name='ck_bookmark_one_target'))
    indexes('learning_bookmarks','user_id')
    for table in ['learning_paper_progress', 'learning_paper_attachment_progress']:
        extra = [sa.UniqueConstraint('user_id','paper_id',name='uq_reading_paper')]
        if table.endswith('attachment_progress'):
            extra = [sa.Column('attachment_id',sa.Integer(),sa.ForeignKey('paper_attachments.id',ondelete='SET NULL')),
                     sa.Column('relation_id_at_recording',sa.Integer(),nullable=False),
                     sa.Column('attachment_version',sa.Integer(),nullable=False),
                     sa.UniqueConstraint('user_id','attachment_id','attachment_version',name='uq_reading_attachment'),
                     sa.CheckConstraint('attachment_version >= 1',name='ck_reading_attachment_version'),
                     sa.CheckConstraint('relation_id_at_recording > 0 AND (attachment_id IS NULL OR attachment_id = relation_id_at_recording)',name='ck_reading_attachment_identity')]
        op.create_table(table,
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('user_id',sa.Integer(),sa.ForeignKey('user.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('paper_id',sa.Integer(),sa.ForeignKey('papers.id',ondelete='SET NULL')),
            sa.Column('started_at',sa.DateTime(),nullable=False), sa.Column('last_activity_at',sa.DateTime(),nullable=False),
            sa.Column('self_completed_at',sa.DateTime()), sa.Column('created_at',sa.DateTime(),nullable=False),
            sa.Column('updated_at',sa.DateTime(),nullable=False), *extra)
        indexes(table,'user_id','paper_id')
        if table.endswith('attachment_progress'):
            indexes(table,'attachment_id')


def downgrade():
    tables = ['learning_paper_attachment_progress','learning_paper_progress','learning_bookmarks']
    for name in tables:
        if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM '+name)).scalar():
            raise RuntimeError('Cannot downgrade nonempty bookmark or reading history; preserve personal records first.')
    for name in tables:
        op.drop_table(name)
