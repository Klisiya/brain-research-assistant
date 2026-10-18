"""Flat discussion relations and private governance; content uses Hub revisions."""
from datetime import datetime


def define_discussion_models(db):
    class HubDiscussion(db.Model):
        __tablename__ = 'hub_discussions'
        entry_id = db.Column(db.Integer, db.ForeignKey('hub_entries.id', ondelete='RESTRICT'), primary_key=True)
        thread_id = db.Column(db.Integer, db.ForeignKey('hub_entries.id', ondelete='RESTRICT'), index=True)
        __table_args__ = (db.CheckConstraint('thread_id IS NULL OR thread_id != entry_id', name='ck_discussion_parent'),)

    class HubReport(db.Model):
        __tablename__ = 'hub_reports'
        __table_args__ = (
            db.CheckConstraint("target_type IN ('thread','reply')", name='ck_hub_report_type'),
            db.CheckConstraint("status IN ('open','resolved','dismissed')", name='ck_hub_report_status'),
            db.CheckConstraint('version >= 1', name='ck_hub_report_version'),
            {'sqlite_autoincrement': True},
        )
        id = db.Column(db.Integer, primary_key=True)
        target_entry_id = db.Column(db.Integer, db.ForeignKey('hub_entries.id', ondelete='RESTRICT'), index=True)
        original_target_id = db.Column(db.Integer, nullable=False)
        target_type = db.Column(db.String(10), nullable=False)
        reporter_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False)
        reason = db.Column(db.String(200), nullable=False)
        detail = db.Column(db.String(2000))
        status = db.Column(db.String(12), nullable=False, default='open', index=True)
        version = db.Column(db.Integer, nullable=False, default=1)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        resolved_at = db.Column(db.DateTime)
        resolved_by = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'))

    class HubReportEvent(db.Model):
        __tablename__ = 'hub_report_events'
        __table_args__ = (db.CheckConstraint("action IN ('reported','resolved','dismissed','target_deleted')", name='ck_report_event_action'),)
        id = db.Column(db.Integer, primary_key=True)
        report_id = db.Column(db.Integer, db.ForeignKey('hub_reports.id', ondelete='RESTRICT'), nullable=False, index=True)
        actor_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False)
        action = db.Column(db.String(20), nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    return HubDiscussion, HubReport, HubReportEvent
