"""Personal bookmarks and explicit paper activity with live resource identities."""
from datetime import datetime


def define_reading_models(db):
    class Bookmark(db.Model):
        __tablename__ = 'learning_bookmarks'
        __table_args__ = (
            db.CheckConstraint('(CASE WHEN paper_id IS NULL THEN 0 ELSE 1 END + CASE WHEN course_id IS NULL THEN 0 ELSE 1 END + CASE WHEN module_id IS NULL THEN 0 ELSE 1 END + CASE WHEN research_area_id IS NULL THEN 0 ELSE 1 END) = 1', name='ck_bookmark_one_target'),
            *(db.UniqueConstraint('user_id', column, name=f'uq_bookmark_{column}') for column in ['paper_id', 'course_id', 'module_id', 'research_area_id']),
        )
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='CASCADE'))
        course_id = db.Column(db.Integer, db.ForeignKey('courses.id', ondelete='CASCADE'))
        module_id = db.Column(db.Integer, db.ForeignKey('course_modules.id', ondelete='CASCADE'))
        research_area_id = db.Column(db.Integer, db.ForeignKey('research_areas.id', ondelete='CASCADE'))
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        paper = db.relationship('Paper')
        course = db.relationship('Course')
        module = db.relationship('CourseModule')
        research_area = db.relationship('ResearchArea')

    class ActivityFields:
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        last_activity_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        self_completed_at = db.Column(db.DateTime)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    class PaperReadingProgress(ActivityFields, db.Model):
        __tablename__ = 'learning_paper_progress'
        __table_args__ = (db.UniqueConstraint('user_id', 'paper_id', name='uq_reading_paper'),)
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='SET NULL'), index=True)
        paper = db.relationship('Paper')

    class PaperAttachmentProgress(ActivityFields, db.Model):
        __tablename__ = 'learning_paper_attachment_progress'
        __table_args__ = (
            db.UniqueConstraint('user_id', 'attachment_id', 'attachment_version', name='uq_reading_attachment'),
            db.CheckConstraint('attachment_version >= 1', name='ck_reading_attachment_version'),
            db.CheckConstraint('relation_id_at_recording > 0 AND (attachment_id IS NULL OR attachment_id = relation_id_at_recording)', name='ck_reading_attachment_identity'),
        )
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='SET NULL'), index=True)
        attachment_id = db.Column(db.Integer, db.ForeignKey('paper_attachments.id', ondelete='SET NULL'), index=True)
        relation_id_at_recording = db.Column(db.Integer, nullable=False)
        attachment_version = db.Column(db.Integer, nullable=False)

    return Bookmark, PaperReadingProgress, PaperAttachmentProgress
