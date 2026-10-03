"""Add private plain-text paper notes and concepts, without data seeds."""
from alembic import op
import sqlalchemy as sa

revision = 'e63a9d20bf17'
down_revision = 'd42b7c901ea6'
branch_labels = None
depends_on = None

SOURCE_CHECK = "(attachment_relation_id_at_recording IS NULL AND resource_version IS NULL AND attachment_id IS NULL) OR (attachment_relation_id_at_recording IS NOT NULL AND resource_version IS NOT NULL AND attachment_relation_id_at_recording > 0 AND resource_version >= 1 AND (attachment_id IS NULL OR attachment_id = attachment_relation_id_at_recording))"


def upgrade():
    for kind,table in [('note','learning_guided_notes'),('highlight','learning_concept_highlights')]:
        fields = [sa.Column('title',sa.String(200),nullable=False), sa.Column('body',sa.Text(),nullable=False), sa.Column('note_type',sa.String(20),nullable=False),
                  sa.CheckConstraint("note_type IN ('general','summary','question','connection','key_idea')",name='ck_note_type'),
                  sa.CheckConstraint('length(title) BETWEEN 1 AND 200 AND length(body) BETWEEN 1 AND 10000',name='ck_note_text')] if kind=='note' else [
                  sa.Column('highlight_text',sa.String(1000),nullable=False),sa.Column('comment',sa.String(2000)),
                  sa.CheckConstraint('length(highlight_text) BETWEEN 1 AND 1000 AND (comment IS NULL OR length(comment) <= 2000)',name='ck_highlight_text')]
        op.create_table(table,
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('user_id',sa.Integer(),sa.ForeignKey('user.id',ondelete='RESTRICT'),nullable=False),
            sa.Column('paper_id',sa.Integer(),sa.ForeignKey('papers.id',ondelete='SET NULL')),
            sa.Column('attachment_id',sa.Integer(),sa.ForeignKey('paper_attachments.id',ondelete='SET NULL')),
            sa.Column('attachment_relation_id_at_recording',sa.Integer()),sa.Column('resource_version',sa.Integer()),
            sa.Column('revision',sa.Integer(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),
            sa.CheckConstraint(SOURCE_CHECK,name=f'ck_{kind}_source'),sa.CheckConstraint('revision >= 1',name=f'ck_{kind}_revision'),*fields,sqlite_autoincrement=True)
        for column in ['user_id','paper_id','attachment_id']:
            op.create_index(f'ix_{table}_{column}',table,[column])


def downgrade():
    tables=['learning_concept_highlights','learning_guided_notes']
    for table in tables:
        if op.get_bind().execute(sa.text('SELECT COUNT(*) FROM '+table)).scalar():
            raise RuntimeError('Cannot downgrade nonempty notes or highlights; preserve personal records first.')
    for table in tables:
        op.drop_table(table)
