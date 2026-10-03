"""Add explicit module readings without inferring content associations."""
from alembic import op
import sqlalchemy as sa

revision = 'b9e27f104c63'
down_revision = 'a7d3b920e641'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('course_module_papers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('module_id', sa.Integer(), sa.ForeignKey('course_modules.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('paper_id', sa.Integer(), sa.ForeignKey('papers.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('reading_type', sa.String(30), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.UniqueConstraint('module_id','paper_id',name='uq_module_paper'),
        sa.CheckConstraint("reading_type IN ('required','recommended')",name='ck_module_paper_reading'),
        sa.CheckConstraint('sort_order >= 0',name='ck_module_paper_order'))
    for field in ['module_id','paper_id']:
        op.create_index('ix_course_module_papers_'+field,'course_module_papers',[field])


def downgrade():
    connection = op.get_bind()
    table = sa.table('course_module_papers', sa.column('id'))
    if connection.execute(sa.select(sa.func.count()).select_from(table)).scalar():
        raise RuntimeError('Cannot downgrade module readings with curated relations; preserve them explicitly first.')
    op.drop_table('course_module_papers')
