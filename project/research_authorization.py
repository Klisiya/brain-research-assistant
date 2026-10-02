from flask_login import current_user
from account_service import account_role


class ResearchAuthorization:
    def __init__(self, Area, Staff): self.Area, self.Staff = Area, Staff

    def can_manage(self, area):
        if not isinstance(area, self.Area) or not current_user.is_authenticated or not current_user.is_active:
            return False
        role = account_role(current_user.role)
        return role == 'admin' or (role == 'teacher' and self.Staff.query.filter_by(research_area_id=area.id,user_id=current_user.id).first() is not None)

    def can_read(self, area, relation):
        if not isinstance(area, self.Area): return False
        if self.can_manage(area): return True
        return area.status == 'published' and (relation.access_level == 'public' or (
            relation.access_level == 'authenticated' and current_user.is_authenticated and current_user.is_active))
