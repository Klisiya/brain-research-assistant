"""Explicit canonical bootstrap; never a runtime startup hook."""
import json
from pathlib import Path


def canonical_research():
    return json.loads((Path(__file__).parent/'migrations/data/research_areas.json').read_text(encoding='utf-8'))


def bootstrap_research(db, Area, ModuleLink, Course, Module, brain_regions):
    data = canonical_research(); added = 0
    for item in data['areas']:
        area = Area.query.filter_by(code=item['code']).first()
        if area is not None:
            continue  # Existing edits and curated associations remain authoritative.
        if not set(item['brainRegionSlugs']).issubset(brain_regions): raise ValueError('Unknown anatomical region.')
        area = Area(code=item['code'],slug=item['slug'],name=item['name'],overview=item['overview'],
                    subtopics=item['subtopics'],brain_region_slugs=item['brainRegionSlugs'],sort_order=item['sortOrder'],status='published')
        db.session.add(area); db.session.flush(); added += 1
        course = Course.query.filter_by(slug=data['courseSlug']).first()
        for order, slug in enumerate(data['moduleLinks'].get(area.slug, [])):
            module = Module.query.filter_by(course_id=course.id,slug=slug).first() if course else None
            if module is None: raise ValueError('Required canonical course module is unavailable.')
            db.session.add(ModuleLink(research_area_id=area.id,module_id=module.id,sort_order=order))
    db.session.flush()
    return added
