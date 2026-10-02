"""Discipline taxonomy; anatomical regions and course ownership remain separate."""
from datetime import datetime


def define_research_models(db):
    class ResearchArea(db.Model):
        __tablename__ = 'research_areas'
        __table_args__ = (
            db.CheckConstraint("code IN ('RA-01','RA-02','RA-03','RA-04','RA-05','RA-06')", name='ck_research_code'),
            db.CheckConstraint("status IN ('draft','published','archived')", name='ck_research_status'),
            db.CheckConstraint('sort_order BETWEEN 1 AND 6', name='ck_research_order'),
        )
        id = db.Column(db.Integer, primary_key=True)
        code = db.Column(db.String(10), nullable=False, unique=True)
        slug = db.Column(db.String(220), nullable=False, unique=True)
        name = db.Column(db.String(150), nullable=False)
        overview = db.Column(db.Text, nullable=False)
        subtopics = db.Column(db.JSON, nullable=False, default=list)
        brain_region_slugs = db.Column(db.JSON, nullable=False, default=list)
        status = db.Column(db.String(30), nullable=False, default='draft')
        sort_order = db.Column(db.Integer, nullable=False, unique=True)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    class ResearchAreaStaff(db.Model):
        __tablename__ = 'research_area_staff'
        __table_args__ = (db.UniqueConstraint('research_area_id','user_id',name='uq_research_staff_user'),
                          db.CheckConstraint("role = 'editor'",name='ck_research_staff_role'))
        id = db.Column(db.Integer, primary_key=True)
        research_area_id = db.Column(db.Integer, db.ForeignKey('research_areas.id', ondelete='CASCADE'), nullable=False, index=True)
        user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='RESTRICT'), nullable=False, index=True)
        role = db.Column(db.String(30), nullable=False, default='editor')
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        user = db.relationship('User')

    class ResearchAreaPaper(db.Model):
        __tablename__ = 'research_area_papers'
        __table_args__ = (db.UniqueConstraint('research_area_id','paper_id',name='uq_research_paper'),
                          db.CheckConstraint('sort_order >= 0',name='ck_research_paper_order'))
        id = db.Column(db.Integer, primary_key=True)
        research_area_id = db.Column(db.Integer, db.ForeignKey('research_areas.id', ondelete='CASCADE'), nullable=False, index=True)
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='CASCADE'), nullable=False, index=True)
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        paper = db.relationship('Paper')

    class ResearchAreaModule(db.Model):
        __tablename__ = 'research_area_modules'
        __table_args__ = (db.UniqueConstraint('research_area_id','module_id',name='uq_research_module'),
                          db.CheckConstraint('sort_order >= 0',name='ck_research_module_order'))
        id = db.Column(db.Integer, primary_key=True)
        research_area_id = db.Column(db.Integer, db.ForeignKey('research_areas.id', ondelete='CASCADE'), nullable=False, index=True)
        module_id = db.Column(db.Integer, db.ForeignKey('course_modules.id', ondelete='CASCADE'), nullable=False, index=True)
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        module = db.relationship('CourseModule')

    class ResearchAreaResource(db.Model):
        __tablename__ = 'research_area_resources'
        __table_args__ = (db.UniqueConstraint('research_area_id','asset_id',name='uq_research_resource_asset'),
                          db.CheckConstraint("access_level IN ('public','authenticated','staff')",name='ck_research_resource_access'),
                          db.CheckConstraint('version >= 1',name='ck_research_resource_version'),
                          db.CheckConstraint('sort_order >= 0',name='ck_research_resource_order'))
        id = db.Column(db.Integer, primary_key=True)
        research_area_id = db.Column(db.Integer, db.ForeignKey('research_areas.id', ondelete='RESTRICT'), nullable=False, index=True)
        asset_id = db.Column(db.Integer, db.ForeignKey('file_assets.id', ondelete='RESTRICT'), nullable=False, index=True)
        display_name = db.Column(db.String(300), nullable=False)
        description = db.Column(db.String(1000))
        access_level = db.Column(db.String(30), nullable=False, default='public')
        version = db.Column(db.Integer, nullable=False, default=1)
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
        updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
        asset = db.relationship('FileAsset')

    return ResearchArea, ResearchAreaStaff, ResearchAreaPaper, ResearchAreaModule, ResearchAreaResource
