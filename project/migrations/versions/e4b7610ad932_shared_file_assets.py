"""Add shared assets while retaining attachment metadata for compatibility."""
from alembic import op
import sqlalchemy as sa

revision = "e4b7610ad932"
down_revision = "d2f481a6c930"
branch_labels = None
depends_on = None
NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def attachment_sequence(connection):
    if connection.dialect.name == "sqlite":
        return connection.execute(sa.text("SELECT seq FROM sqlite_sequence WHERE name='paper_attachments'")).scalar() or 0
    return None


def restore_sequence(connection, value):
    if value is not None:
        current = attachment_sequence(connection)
        if value > current:
            connection.execute(sa.text("DELETE FROM sqlite_sequence WHERE name='paper_attachments'"))
            connection.execute(sa.text("INSERT INTO sqlite_sequence(name,seq) VALUES('paper_attachments',:value)"), {"value": value})


def upgrade():
    op.create_table("file_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("asset_type", sa.String(30), nullable=False),
        sa.Column("original_filename", sa.String(500)),
        sa.Column("storage_key", sa.String(1000), unique=True),
        sa.Column("mime_type", sa.String(150)),
        sa.Column("file_size", sa.Integer()),
        sa.Column("sha256", sa.String(64)),
        sa.Column("external_url", sa.String(1500)),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("asset_type IN ('pdf', 'cover', 'slides', 'document', 'external_link')", name="ck_file_asset_type"),
        sa.CheckConstraint(
            "(asset_type = 'external_link' AND external_url IS NOT NULL AND storage_key IS NULL "
            "AND sha256 IS NULL AND file_size IS NULL AND mime_type IS NULL AND original_filename IS NULL) OR "
            "(asset_type != 'external_link' AND external_url IS NULL AND storage_key IS NOT NULL "
            "AND sha256 IS NOT NULL AND file_size > 0 AND mime_type IS NOT NULL AND original_filename IS NOT NULL)",
            name="ck_file_asset_resource"),
        sqlite_autoincrement=True)
    op.create_index("ix_file_assets_sha256", "file_assets", ["sha256"])
    connection = op.get_bind()
    connection.execute(sa.text("""INSERT INTO file_assets
        (id,asset_type,original_filename,storage_key,mime_type,file_size,sha256,external_url,created_by_id,created_at,updated_at)
        SELECT id,attachment_type,original_filename,storage_key,mime_type,file_size,sha256,external_url,uploaded_by_id,created_at,updated_at
        FROM paper_attachments"""))
    sequence = attachment_sequence(connection)
    unique = next(item for item in sa.inspect(connection).get_unique_constraints("paper_attachments")
                  if item["column_names"] == ["storage_key"])
    with op.batch_alter_table("paper_attachments", naming_convention=NAMING, table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.add_column(sa.Column("asset_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_paper_attachment_asset", "file_assets", ["asset_id"], ["id"], ondelete="RESTRICT")
        batch.create_index("ix_paper_attachments_asset_id", ["asset_id"])
        batch.drop_constraint(unique["name"] or "uq_paper_attachments_storage_key", type_="unique")
    restore_sequence(connection, sequence)
    connection.execute(sa.text("UPDATE paper_attachments SET asset_id=id"))
    if connection.dialect.name == "postgresql":
        connection.execute(sa.text("SELECT setval(pg_get_serial_sequence('file_assets','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM file_assets"))


def downgrade():
    connection = op.get_bind()
    # The old schema cannot represent sharing. Refuse before mutating anything.
    duplicates = connection.execute(sa.text("SELECT storage_key FROM paper_attachments WHERE storage_key IS NOT NULL GROUP BY storage_key HAVING COUNT(*) > 1")).first()
    unrepresented = connection.execute(sa.text("SELECT id FROM file_assets WHERE id NOT IN (SELECT asset_id FROM paper_attachments WHERE asset_id IS NOT NULL) LIMIT 1")).first()
    inspector = sa.inspect(connection)
    other_references = any(fk["referred_table"] == "file_assets" for table in inspector.get_table_names()
                           if table != "paper_attachments" for fk in inspector.get_foreign_keys(table))
    if duplicates or unrepresented or other_references:
        raise RuntimeError("Cannot downgrade shared assets without a preservation strategy for all references.")
    sequence = attachment_sequence(connection)
    with op.batch_alter_table("paper_attachments", naming_convention=NAMING, table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_constraint("fk_paper_attachment_asset", type_="foreignkey")
        batch.drop_index("ix_paper_attachments_asset_id")
        batch.drop_column("asset_id")
        batch.create_unique_constraint("uq_paper_attachments_storage_key", ["storage_key"])
    restore_sequence(connection, sequence)
    op.drop_index("ix_file_assets_sha256", table_name="file_assets")
    op.drop_table("file_assets")
