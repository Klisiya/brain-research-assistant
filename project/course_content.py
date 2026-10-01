"""Explicit, idempotent bootstrap. Never called during ordinary app startup."""
import json
from pathlib import Path

MODULE_FIELDS = {
    "number": "number", "slug": "slug", "title": "title", "titleZh": "title_zh",
    "durationHours": "duration_hours", "category": "category", "description": "description",
    "learningFocus": "learning_focus", "coverVariant": "cover_variant",
}


def canonical_content():
    return json.loads((Path(__file__).parent / "migrations/data/r4a_course.json").read_text(encoding="utf-8"))


def bootstrap_course(db, Course, Module):
    content = canonical_content()
    values = content["course"]
    course = Course.query.filter_by(slug=values["slug"]).first()
    if course is None:
        course = Course(slug=values["slug"], title=values["title"], title_zh=values["titleZh"],
                        description=values["description"], status="published")
        db.session.add(course)
        db.session.flush()
    added = 0
    for item in content["modules"]:
        if Module.query.filter_by(course_id=course.id, slug=item["slug"]).first() is not None:
            continue
        if Module.query.filter_by(course_id=course.id, number=item["number"]).first() is not None:
            raise ValueError("A canonical module number is already occupied. No content was overwritten.")
        db.session.add(Module(course_id=course.id, status="published",
                              **{target: item[source] for source, target in MODULE_FIELDS.items()}))
        added += 1
    db.session.flush()
    return course, added
