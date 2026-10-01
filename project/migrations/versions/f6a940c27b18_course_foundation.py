"""Add course content and scoped resource relations; preserve the original 12 modules."""
from datetime import datetime
import json
from pathlib import Path
from alembic import op
import sqlalchemy as sa

revision = "f6a940c27b18"
down_revision = "e4b7610ad932"
branch_labels = None
depends_on = None

FIELDS = {"number": "number", "slug": "slug", "title": "title", "titleZh": "title_zh",
          "durationHours": "duration_hours", "category": "category", "description": "description",
          "learningFocus": "learning_focus", "coverVariant": "cover_variant"}


def content():
    return json.loads((Path(__file__).resolve().parents[1] / "data/r4a_course.json").read_text(encoding="utf-8"))


def timestamps():
    return [sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False)]


def upgrade():
    op.create_table("courses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(220), nullable=False, unique=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("title_zh", sa.String(300)),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        *timestamps(),
        sa.CheckConstraint("status IN ('draft','published','archived')", name="ck_course_status"))
    op.create_table("course_modules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("title_zh", sa.String(300), nullable=False),
        sa.Column("duration_hours", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("learning_focus", sa.Text(), nullable=False),
        sa.Column("cover_variant", sa.String(60), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("course_id", "slug", name="uq_course_module_slug"),
        sa.UniqueConstraint("course_id", "number", name="uq_course_module_number"),
        sa.CheckConstraint("number > 0", name="ck_course_module_number"),
        sa.CheckConstraint("duration_hours > 0", name="ck_course_module_duration"),
        sa.CheckConstraint("status IN ('draft','published','archived')", name="ck_course_module_status"))
    op.create_index("ix_course_modules_course_id", "course_modules", ["course_id"])
    op.create_table("course_staff",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("course_id", "user_id", name="uq_course_staff_user"),
        sa.CheckConstraint("role IN ('instructor','assistant')", name="ck_course_staff_role"))
    for field in ["course_id", "user_id"]:
        op.create_index("ix_course_staff_"+field, "course_staff", [field])
    for table, prefix, parent, target in [
        ("course_resources", "course_resource", "course_id", "courses.id"),
        ("module_resources", "module_resource", "module_id", "course_modules.id"),
    ]:
        op.create_table(table,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(parent, sa.Integer(), sa.ForeignKey(target, ondelete="RESTRICT"), nullable=False),
            sa.Column("asset_id", sa.Integer(), sa.ForeignKey("file_assets.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("display_name", sa.String(300), nullable=False),
            sa.Column("description", sa.String(1000)),
            sa.Column("access_level", sa.String(30), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            *timestamps(),
            sa.CheckConstraint("access_level IN ('public','authenticated','staff')", name=f"ck_{prefix}_access"),
            sa.CheckConstraint("version >= 1", name=f"ck_{prefix}_version"),
            sa.CheckConstraint("sort_order >= 0", name=f"ck_{prefix}_sort"),
            sa.UniqueConstraint(parent, "asset_id", name=f"uq_{prefix}_asset"))
        for field in [parent, "asset_id"]:
            op.create_index(f"ix_{table}_{field}", table, [field])

    connection = op.get_bind()
    tables = sa.MetaData()
    course_table = sa.Table("courses", tables, autoload_with=connection)
    module_table = sa.Table("course_modules", tables, autoload_with=connection)
    data = content()
    now = datetime.utcnow()
    values = data["course"]
    result = connection.execute(course_table.insert().values(slug=values["slug"], title=values["title"],
        title_zh=values["titleZh"], description=values["description"], status="published", created_at=now, updated_at=now))
    course_id = result.inserted_primary_key[0]
    connection.execute(module_table.insert(), [dict(course_id=course_id, status="published", created_at=now, updated_at=now,
        **{target: item[source] for source, target in FIELDS.items()}) for item in data["modules"]])


def downgrade():
    connection = op.get_bind()
    data = content()
    courses = connection.execute(sa.text("SELECT slug,title,title_zh,description,status FROM courses")).mappings().all()
    expected = {"slug": data["course"]["slug"], "title": data["course"]["title"], "title_zh": data["course"]["titleZh"],
                "description": data["course"]["description"], "status": "published"}
    modules = connection.execute(sa.text("SELECT " + ",".join(FIELDS.values()) + ",status FROM course_modules ORDER BY number")).mappings().all()
    expected_modules = [dict(status="published", **{target: item[source] for source, target in FIELDS.items()}) for item in data["modules"]]
    referenced = any(connection.execute(sa.text("SELECT COUNT(*) FROM "+table)).scalar()
                     for table in ["course_staff", "course_resources", "module_resources"])
    if [dict(row) for row in courses] != [expected] or [dict(row) for row in modules] != expected_modules or referenced:
        raise RuntimeError("Cannot downgrade course content with edits or references; preserve it explicitly first.")
    for table in ["module_resources", "course_resources", "course_staff", "course_modules", "courses"]:
        op.drop_table(table)
