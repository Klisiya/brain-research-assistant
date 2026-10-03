"""Private plain-text notes and concepts, bound to paper/resource identities."""
from datetime import datetime

NOTE_TYPES = ('general', 'summary', 'question', 'connection', 'key_idea')
SOURCE_CHECK = "(attachment_relation_id_at_recording IS NULL AND resource_version IS NULL AND attachment_id IS NULL) OR (attachment_relation_id_at_recording IS NOT NULL AND resource_version IS NOT NULL AND attachment_relation_id_at_recording > 0 AND resource_version >= 1 AND (attachment_id IS NULL OR attachment_id = attachment_relation_id_at_recording))"


def define_annotation_models(db):
    class Fields:
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='SET NULL'), index=True)
        attachment_id = db.Column(db.Integer, db.ForeignKey('paper_attachments.id', ondelete='SET NULL'), index=True)
        attachment_relation_id_at_recording = db.Column(db.Integer)
        resource_version = db.Column(db.Integer)
        revision = db.Column(db.Integer, nullable=False, default=1)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class GuidedNote(Fields, db.Model):
        __tablename__ = 'learning_guided_notes'
        __table_args__ = (
            db.CheckConstraint(SOURCE_CHECK, name='ck_note_source'),
            db.CheckConstraint('revision >= 1', name='ck_note_revision'),
            db.CheckConstraint("note_type IN ('general','summary','question','connection','key_idea')", name='ck_note_type'),
            db.CheckConstraint('length(title) BETWEEN 1 AND 200 AND length(body) BETWEEN 1 AND 10000', name='ck_note_text'),
            {'sqlite_autoincrement': True},
        )
        title = db.Column(db.String(200), nullable=False)
        body = db.Column(db.Text, nullable=False)
        note_type = db.Column(db.String(20), nullable=False)
        paper = db.relationship('Paper')
        attachment = db.relationship('PaperAttachment')

    class ConceptHighlight(Fields, db.Model):
        __tablename__ = 'learning_concept_highlights'
        __table_args__ = (
            db.CheckConstraint(SOURCE_CHECK, name='ck_highlight_source'),
            db.CheckConstraint('revision >= 1', name='ck_highlight_revision'),
            db.CheckConstraint('length(highlight_text) BETWEEN 1 AND 1000 AND (comment IS NULL OR length(comment) <= 2000)', name='ck_highlight_text'),
            {'sqlite_autoincrement': True},
        )
        highlight_text = db.Column(db.String(1000), nullable=False)
        comment = db.Column(db.String(2000))
        paper = db.relationship('Paper')
        attachment = db.relationship('PaperAttachment')

    return GuidedNote, ConceptHighlight
