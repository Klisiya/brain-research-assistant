"""Global teacher identity never implies membership of an individual course."""
from flask_login import current_user
from account_service import account_role


class CourseAuthorization:
    def __init__(self, Course, Module, Staff):
        self.Course, self.Module, self.Staff = Course, Module, Staff

    def can_manage_course(self, course):
        if not isinstance(course, self.Course) or not current_user.is_authenticated or not current_user.is_active:
            return False
        role = account_role(current_user.role)
        if role == "admin":
            return True
        return role == "teacher" and self.Staff.query.filter_by(course_id=course.id, user_id=current_user.id).first() is not None

    def can_read_course(self, course):
        return isinstance(course, self.Course) and (course.status == "published" or self.can_manage_course(course))

    def can_manage_module(self, module):
        return isinstance(module, self.Module) and self.can_manage_course(module.course)

    def can_read_module(self, module):
        return isinstance(module, self.Module) and (
            (module.status == "published" and module.course.status == "published") or self.can_manage_module(module))

    def can_read_resource(self, parent, relation):
        if not isinstance(parent, (self.Course, self.Module)):
            return False
        manage = self.can_manage_module(parent) if isinstance(parent, self.Module) else self.can_manage_course(parent)
        if manage:
            return True
        published = (parent.status == "published" and parent.course.status == "published") if isinstance(parent, self.Module) else parent.status == "published"
        return published and (relation.access_level == "public" or (
            relation.access_level == "authenticated" and current_user.is_authenticated and current_user.is_active))
