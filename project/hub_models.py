"""Small Hub governance foundation; no content seeds or teaching models."""
from datetime import datetime


def define_hub_models(db):
    class HubEntry(db.Model):
        __tablename__ = 'hub_entries'
        __table_args__ = (
            db.CheckConstraint("kind IN ('faculty','industry','discussions','collaboration')", name='ck_hub_kind'),
            db.CheckConstraint('version >= 1', name='ck_hub_version'),
            {'sqlite_autoincrement': True},
        )
        id = db.Column(db.Integer, primary_key=True)
        kind = db.Column(db.String(30), nullable=False)
        owner_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        # Pointers are resolved with entry_id + state checks by every read/write.
        # Avoid a circular Entry/Revision FK, including SQLite drop/upgrade cycles.
        published_revision_id = db.Column(db.Integer)
        working_revision_id = db.Column(db.Integer)
        archived_at = db.Column(db.DateTime)
        version = db.Column(db.Integer, nullable=False, default=1)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class HubRevision(db.Model):
        __tablename__ = 'hub_revisions'
        __table_args__ = (
            db.UniqueConstraint('entry_id', 'number', name='uq_hub_revision_number'),
            db.CheckConstraint("state IN ('draft','pending','approved','rejected')", name='ck_hub_revision_state'),
            db.CheckConstraint('number >= 1', name='ck_hub_revision_number'),
            db.CheckConstraint('length(title) BETWEEN 1 AND 200 AND length(body) <= 10000', name='ck_hub_text'),
            {'sqlite_autoincrement': True},
        )
        id = db.Column(db.Integer, primary_key=True)
        entry_id = db.Column(db.Integer, db.ForeignKey('hub_entries.id', ondelete='RESTRICT'), nullable=False, index=True)
        number = db.Column(db.Integer, nullable=False)
        state = db.Column(db.String(20), nullable=False, default='draft', index=True)
        title = db.Column(db.String(200), nullable=False)
        body = db.Column(db.Text, nullable=False, default='')
        source_name = db.Column(db.String(300))
        source_url = db.Column(db.String(1500))
        submitted_at = db.Column(db.DateTime)
        reviewed_at = db.Column(db.DateTime)
        reviewed_by_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'))
        review_note = db.Column(db.String(2000))
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class HubAttachment(db.Model):
        __tablename__ = 'hub_attachments'
        __table_args__ = ({'sqlite_autoincrement': True},)
        id = db.Column(db.Integer, primary_key=True)
        revision_id = db.Column(db.Integer, db.ForeignKey('hub_revisions.id', ondelete='RESTRICT'), nullable=False, index=True)
        asset_id = db.Column(db.Integer, db.ForeignKey('file_assets.id', ondelete='RESTRICT'), nullable=False, index=True)
        display_name = db.Column(db.String(300), nullable=False)
        asset = db.relationship('FileAsset')

    class HubModerationEvent(db.Model):
        __tablename__ = 'hub_moderation_events'
        __table_args__ = (
            db.CheckConstraint("action IN ('created','edited','draft_created','submitted','withdrawn','approved','rejected','archived','attachment_added','attachment_removed')", name='ck_hub_event_action'),
            {'sqlite_autoincrement': True},
        )
        id = db.Column(db.Integer, primary_key=True)
        entry_id = db.Column(db.Integer, db.ForeignKey('hub_entries.id', ondelete='RESTRICT'), nullable=False, index=True)
        revision_id = db.Column(db.Integer, db.ForeignKey('hub_revisions.id', ondelete='RESTRICT'))
        actor_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False)
        action = db.Column(db.String(40), nullable=False)
        note = db.Column(db.String(2000))
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    return HubEntry, HubRevision, HubAttachment, HubModerationEvent
