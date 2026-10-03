"""Explicit module reading relations, independent of topics and ownership."""
def define_module_paper(db):
    class CourseModulePaper(db.Model):
        __tablename__ = 'course_module_papers'
        __table_args__ = (
            db.UniqueConstraint('module_id', 'paper_id', name='uq_module_paper'),
            db.CheckConstraint("reading_type IN ('required','recommended')", name='ck_module_paper_reading'),
            db.CheckConstraint('sort_order >= 0', name='ck_module_paper_order'),
        )
        id = db.Column(db.Integer, primary_key=True)
        module_id = db.Column(db.Integer, db.ForeignKey('course_modules.id', ondelete='RESTRICT'), nullable=False, index=True)
        paper_id = db.Column(db.Integer, db.ForeignKey('papers.id', ondelete='RESTRICT'), nullable=False, index=True)
        reading_type = db.Column(db.String(30), nullable=False, default='recommended')
        sort_order = db.Column(db.Integer, nullable=False, default=0)
        paper = db.relationship('Paper')
        module = db.relationship('CourseModule')
    return CourseModulePaper


def reading_rows(Link, module_id, can_manage_paper=None):
    from sqlalchemy.orm import joinedload
    rows = Link.query.options(joinedload(Link.paper)).filter_by(module_id=module_id).order_by(Link.sort_order, Link.id).all()
    result = []
    for row in rows:
        public = row.paper.status == 'published'
        if not public and can_manage_paper is None:
            continue
        visible = public or can_manage_paper(row.paper)
        item = dict(relationId=row.id, readingType=row.reading_type, sortOrder=row.sort_order,
                    paper=dict(slug=row.paper.slug, title=row.paper.title, authors=row.paper.authors) if visible else None)
        if can_manage_paper is not None:
            item['status'] = row.paper.status
        result.append(item)
    return result
