"""Private learning identity and self-reported activity, separate from assessment."""
from datetime import datetime


def define_learning_models(db):
    class Enrollment(db.Model):
        __tablename__ = 'learning_enrollments'
        __table_args__ = (
            db.UniqueConstraint('user_id', 'course_id', name='uq_learning_enrollment'),
            db.CheckConstraint("state = 'active'", name='ck_learning_enrollment_state'),
            db.CheckConstraint('completion_rule_version >= 1', name='ck_learning_rule_version'),
        )
        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        course_id = db.Column(db.Integer, db.ForeignKey('courses.id', ondelete='RESTRICT'), nullable=False, index=True)
        state = db.Column(db.String(20), nullable=False, default='active')
        completion_rule_version = db.Column(db.Integer, nullable=False, default=1)
        enrolled_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        last_activity_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        course = db.relationship('Course')

    class ModuleProgress(db.Model):
        __tablename__ = 'learning_module_progress'
        __table_args__ = (db.UniqueConstraint('enrollment_id', 'module_id', name='uq_learning_module'),)
        id = db.Column(db.Integer, primary_key=True)
        enrollment_id = db.Column(db.Integer, db.ForeignKey('learning_enrollments.id', ondelete='RESTRICT'), nullable=False, index=True)
        module_id = db.Column(db.Integer, db.ForeignKey('course_modules.id', ondelete='RESTRICT'), nullable=False, index=True)
        started_at = db.Column(db.DateTime)
        last_activity_at = db.Column(db.DateTime)
        self_completed_at = db.Column(db.DateTime)
        verified_completed_at = db.Column(db.DateTime)
        module = db.relationship('CourseModule')

    class ResourceFields:
        id = db.Column(db.Integer, primary_key=True)
        enrollment_id = db.Column(db.Integer, db.ForeignKey('learning_enrollments.id', ondelete='RESTRICT'), nullable=False, index=True)
        relation_id_at_recording = db.Column(db.Integer, nullable=False)
        resource_version = db.Column(db.Integer, nullable=False)
        started_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        last_activity_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        self_completed_at = db.Column(db.DateTime)

    def constraints(prefix):
        return (
            db.UniqueConstraint('enrollment_id', 'resource_id', 'resource_version', name=f'uq_{prefix}'),
            db.CheckConstraint('resource_version >= 1', name=f'ck_{prefix}_version'),
            db.CheckConstraint('relation_id_at_recording > 0 AND (resource_id IS NULL OR resource_id = relation_id_at_recording)', name=f'ck_{prefix}_identity'),
        )

    class CourseResourceProgress(ResourceFields, db.Model):
        __tablename__ = 'learning_course_resource_progress'
        __table_args__ = constraints('learning_course_resource')
        resource_id = db.Column(db.Integer, db.ForeignKey('course_resources.id', ondelete='SET NULL'), index=True)

    class ModuleResourceProgress(ResourceFields, db.Model):
        __tablename__ = 'learning_module_resource_progress'
        __table_args__ = constraints('learning_module_resource')
        resource_id = db.Column(db.Integer, db.ForeignKey('module_resources.id', ondelete='SET NULL'), index=True)

    return Enrollment, ModuleProgress, CourseResourceProgress, ModuleResourceProgress
