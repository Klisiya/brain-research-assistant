"""Immutable physical metadata; business relations own visibility and versions."""
from datetime import datetime

ASSET_FIELDS = ("original_filename", "storage_key", "mime_type", "file_size", "sha256", "external_url")


def define_file_asset(db):
    class FileAsset(db.Model):
        __tablename__ = "file_assets"
        __table_args__ = (
            db.CheckConstraint("asset_type IN ('pdf', 'cover', 'slides', 'document', 'external_link')", name="ck_file_asset_type"),
            db.CheckConstraint(
                "(asset_type = 'external_link' AND external_url IS NOT NULL AND storage_key IS NULL "
                "AND sha256 IS NULL AND file_size IS NULL AND mime_type IS NULL AND original_filename IS NULL) OR "
                "(asset_type != 'external_link' AND external_url IS NULL AND storage_key IS NOT NULL "
                "AND sha256 IS NOT NULL AND file_size > 0 AND mime_type IS NOT NULL AND original_filename IS NOT NULL)",
                name="ck_file_asset_resource"),
            {"sqlite_autoincrement": True},
        )
        id = db.Column(db.Integer, primary_key=True)
        asset_type = db.Column(db.String(30), nullable=False)
        original_filename = db.Column(db.String(500))
        storage_key = db.Column(db.String(1000), unique=True)
        mime_type = db.Column(db.String(150))
        file_size = db.Column(db.Integer)
        sha256 = db.Column(db.String(64), index=True)
        external_url = db.Column(db.String(1500))
        created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    return FileAsset
