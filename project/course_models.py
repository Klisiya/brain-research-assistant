"""Course content, scoped staff membership and references to shared assets."""
from datetime import datetime


def define_course_models(db):
    class Course(db.Model):
        __tablename__ = "courses"
        __table_args__ = (db.CheckConstraint("status IN ('draft','published','archived')", name="ck_course_status"),)
        id = db.Column(db.Integer, primary_key=True)
        slug = db.Column(db.String(220), nullable=False, unique=True)
        title = db.Column(db.String(300), nullable=False)
        title_zh = db.Column(db.String(300))
        description = db.Column(db.Text, nullable=False)
        status = db.Column(db.String(30), nullable=False, default="draft")
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
        modules = db.relationship("CourseModule", back_populates="course", order_by="CourseModule.number", passive_deletes="all")

    class CourseModule(db.Model):
        __tablename__ = "course_modules"
        __table_args__ = (
            db.UniqueConstraint("course_id", "slug", name="uq_course_module_slug"),
            db.UniqueConstraint("course_id", "number", name="uq_course_module_number"),
            db.CheckConstraint("number > 0", name="ck_course_module_number"),
            db.CheckConstraint("duration_hours > 0", name="ck_course_module_duration"),
            db.CheckConstraint("status IN ('draft','published','archived')", name="ck_course_module_status"),
        )
        id = db.Column(db.Integer, primary_key=True)
        course_id = db.Column(db.Integer, db.ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False, index=True)
        number = db.Column(db.Integer, nullable=False)
        slug = db.Column(db.String(220), nullable=False)
        title = db.Column(db.String(300), nullable=False)
        title_zh = db.Column(db.String(300), nullable=False)
        duration_hours = db.Column(db.Integer, nullable=False)
        category = db.Column(db.String(150), nullable=False)
        description = db.Column(db.Text, nullable=False)
        learning_focus = db.Column(db.Text, nullable=False)
        cover_variant = db.Column(db.String(60), nullable=False)
        status = db.Column(db.String(30), nullable=False, default="draft")
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
        course = db.relationship("Course", back_populates="modules")

    class CourseStaff(db.Model):
        __tablename__ = "course_staff"
        __table_args__ = (
            db.UniqueConstraint("course_id", "user_id", name="uq_course_staff_user"),
            db.CheckConstraint("role IN ('instructor','assistant')", name="ck_course_staff_role"),
        )
        id = db.Column(db.Integer, primary_key=True)
        course_id = db.Column(db.Integer, db.ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False, index=True)
        user_id = db.Column(db.Integer, db.ForeignKey("user.id", ondelete="RESTRICT"), nullable=False, index=True)
        role = db.Column(db.String(30), nullable=False, default="instructor")
        course = db.relationship("Course")
        user = db.relationship("User")
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    class ResourceFields:
        id = db.Column(db.Integer, primary_key=True)
        asset_id = db.Column(db.Integer, db.ForeignKey("file_assets.id", ondelete="RESTRICT"), nullable=False, index=True)
        display_name = db.Column(db.String(300), nullable=False)
        description = db.Column(db.String(1000))
        access_level = db.Column(db.String(30), nullable=False, default="public")
        version = db.Column(db.Integer, nullable=False, default=1)
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    def resource_constraints(prefix, parent):
        return (
            db.CheckConstraint("access_level IN ('public','authenticated','staff')", name=f"ck_{prefix}_access"),
            db.CheckConstraint("version >= 1", name=f"ck_{prefix}_version"),
            db.CheckConstraint("sort_order >= 0", name=f"ck_{prefix}_sort"),
            db.UniqueConstraint(parent, "asset_id", name=f"uq_{prefix}_asset"),
        )

    class CourseResource(ResourceFields, db.Model):
        __tablename__ = "course_resources"
        __table_args__ = resource_constraints("course_resource", "course_id")
        course_id = db.Column(db.Integer, db.ForeignKey("courses.id", ondelete="RESTRICT"), nullable=False, index=True)
        course = db.relationship("Course")
        asset = db.relationship("FileAsset")

    class ModuleResource(ResourceFields, db.Model):
        __tablename__ = "module_resources"
        __table_args__ = resource_constraints("module_resource", "module_id")
        module_id = db.Column(db.Integer, db.ForeignKey("course_modules.id", ondelete="RESTRICT"), nullable=False, index=True)
        module = db.relationship("CourseModule")
        asset = db.relationship("FileAsset")

    return Course, CourseModule, CourseStaff, CourseResource, ModuleResource
