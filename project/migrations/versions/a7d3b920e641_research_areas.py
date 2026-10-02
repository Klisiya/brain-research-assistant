"""Add six discipline areas and explicit curated relations without classifying Papers."""
from datetime import datetime
import json
from pathlib import Path
from alembic import op
import sqlalchemy as sa

revision = 'a7d3b920e641'
down_revision = 'f6a940c27b18'
branch_labels = None
depends_on = None


def content(): return json.loads((Path(__file__).resolve().parents[1]/'data/research_areas.json').read_text(encoding='utf-8'))


def upgrade():
    op.create_table('research_areas',
        sa.Column('id',sa.Integer(),primary_key=True), sa.Column('code',sa.String(10),nullable=False,unique=True),
        sa.Column('slug',sa.String(220),nullable=False,unique=True), sa.Column('name',sa.String(150),nullable=False),
        sa.Column('overview',sa.Text(),nullable=False), sa.Column('subtopics',sa.JSON(),nullable=False),
        sa.Column('brain_region_slugs',sa.JSON(),nullable=False), sa.Column('status',sa.String(30),nullable=False),
        sa.Column('sort_order',sa.Integer(),nullable=False,unique=True),
        sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),
        sa.CheckConstraint("code IN ('RA-01','RA-02','RA-03','RA-04','RA-05','RA-06')",name='ck_research_code'),
        sa.CheckConstraint("status IN ('draft','published','archived')",name='ck_research_status'),
        sa.CheckConstraint('sort_order BETWEEN 1 AND 6',name='ck_research_order'))
    op.create_table('research_area_staff',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('research_area_id',sa.Integer(),sa.ForeignKey('research_areas.id',ondelete='CASCADE'),nullable=False),
        sa.Column('user_id',sa.Integer(),sa.ForeignKey('user.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('role',sa.String(30),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),
        sa.UniqueConstraint('research_area_id','user_id',name='uq_research_staff_user'),
        sa.CheckConstraint("role = 'editor'",name='ck_research_staff_role'))
    for field in ['research_area_id','user_id']: op.create_index('ix_research_area_staff_'+field,'research_area_staff',[field])
    for kind, field, target in [('paper','paper_id','papers.id'),('module','module_id','course_modules.id')]:
        table = 'research_area_'+kind+'s'
        op.create_table(table,
            sa.Column('id',sa.Integer(),primary_key=True),
            sa.Column('research_area_id',sa.Integer(),sa.ForeignKey('research_areas.id',ondelete='CASCADE'),nullable=False),
            sa.Column(field,sa.Integer(),sa.ForeignKey(target,ondelete='CASCADE'),nullable=False),
            sa.Column('sort_order',sa.Integer(),nullable=False),
            sa.UniqueConstraint('research_area_id',field,name='uq_research_'+kind),
            sa.CheckConstraint('sort_order >= 0',name='ck_research_'+kind+'_order'))
        for column in ['research_area_id',field]: op.create_index('ix_'+table+'_'+column,table,[column])
    op.create_table('research_area_resources',
        sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('research_area_id',sa.Integer(),sa.ForeignKey('research_areas.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('asset_id',sa.Integer(),sa.ForeignKey('file_assets.id',ondelete='RESTRICT'),nullable=False),
        sa.Column('display_name',sa.String(300),nullable=False),sa.Column('description',sa.String(1000)),
        sa.Column('access_level',sa.String(30),nullable=False),sa.Column('version',sa.Integer(),nullable=False),
        sa.Column('sort_order',sa.Integer(),nullable=False),sa.Column('created_at',sa.DateTime(),nullable=False),sa.Column('updated_at',sa.DateTime(),nullable=False),
        sa.UniqueConstraint('research_area_id','asset_id',name='uq_research_resource_asset'),
        sa.CheckConstraint("access_level IN ('public','authenticated','staff')",name='ck_research_resource_access'),
        sa.CheckConstraint('version >= 1',name='ck_research_resource_version'),sa.CheckConstraint('sort_order >= 0',name='ck_research_resource_order'))
    for field in ['research_area_id','asset_id']: op.create_index('ix_research_area_resources_'+field,'research_area_resources',[field])
    connection = op.get_bind(); metadata = sa.MetaData(); data = content(); now = datetime.utcnow()
    areas = sa.Table('research_areas',metadata,autoload_with=connection)
    links = sa.Table('research_area_modules',metadata,autoload_with=connection)
    for item in data['areas']:
        result = connection.execute(areas.insert().values(code=item['code'],slug=item['slug'],name=item['name'],overview=item['overview'],
            subtopics=item['subtopics'],brain_region_slugs=item['brainRegionSlugs'],status='published',sort_order=item['sortOrder'],created_at=now,updated_at=now))
        for order, slug in enumerate(data['moduleLinks'].get(item['slug'],[])):
            module_id = connection.execute(sa.text('SELECT m.id FROM course_modules m JOIN courses c ON c.id=m.course_id WHERE c.slug=:course AND m.slug=:slug'),{'course':data['courseSlug'],'slug':slug}).scalar()
            if module_id is None: raise RuntimeError('Required canonical course module is unavailable; no classification was guessed.')
            connection.execute(links.insert().values(research_area_id=result.inserted_primary_key[0],module_id=module_id,sort_order=order))


def downgrade():
    connection = op.get_bind(); data = content()
    table = sa.Table('research_areas',sa.MetaData(),autoload_with=connection)
    actual = connection.execute(sa.select(table).order_by(table.c.sort_order)).mappings().all()
    fields = ['code','slug','name','overview','subtopics','brain_region_slugs','status','sort_order']
    expected = [dict(code=a['code'],slug=a['slug'],name=a['name'],overview=a['overview'],subtopics=a['subtopics'],brain_region_slugs=a['brainRegionSlugs'],status='published',sort_order=a['sortOrder']) for a in data['areas']]
    references = any(connection.execute(sa.text('SELECT COUNT(*) FROM '+name)).scalar() for name in ['research_area_staff','research_area_papers','research_area_resources'])
    links = connection.execute(sa.text('SELECT a.slug,c.slug,m.slug,r.sort_order FROM research_area_modules r JOIN research_areas a ON a.id=r.research_area_id JOIN course_modules m ON m.id=r.module_id JOIN courses c ON c.id=m.course_id ORDER BY a.sort_order,r.sort_order,r.id')).all()
    expected_links = [(a['slug'],data['courseSlug'],slug,order) for a in data['areas'] for order,slug in enumerate(data['moduleLinks'].get(a['slug'],[]))]
    if [{k:row[k] for k in fields} for row in actual] != expected or references or [tuple(row) for row in links] != expected_links:
        raise RuntimeError('Cannot downgrade research taxonomy with edits or references; preserve it explicitly first.')
    for name in ['research_area_resources','research_area_modules','research_area_papers','research_area_staff','research_areas']: op.drop_table(name)
