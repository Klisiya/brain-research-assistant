"""Public, ranked SQL candidates; only the requested page is hydrated."""
from math import ceil
from urllib.parse import quote
from sqlalchemy import Text, and_, case, cast, exists, func, literal, or_, select, union_all
from sqlalchemy.orm import joinedload

SEARCH_TYPES = ('all', 'papers', 'courses', 'modules', 'research')


class SearchValidationError(ValueError):
    pass


def parse_search(args):
    if set(args) - {'q', 'type', 'page', 'perPage'} or any(len(args.getlist(k)) != 1 for k in args):
        raise SearchValidationError('Invalid or repeated search parameters.')
    q = args.get('q', '').strip()
    if not q or len(q) > 200 or any(ord(c) < 32 or ord(c) == 127 for c in q):
        raise SearchValidationError('Enter a search query of 1–200 characters.')
    kind = args.get('type', 'all')
    if kind not in SEARCH_TYPES:
        raise SearchValidationError('Invalid search type.')
    numbers = []
    for key, default, maximum in [('page', '1', 10000), ('perPage', '12', 50)]:
        value = args.get(key, default)
        if not value.isascii() or not value.isdecimal() or len(value) > 5 or not 1 <= int(value) <= maximum:
            raise SearchValidationError('Invalid search pagination.')
        numbers.append(int(value))
    return dict(q=q, type=kind, page=numbers[0], perPage=numbers[1])


class SearchService:
    def __init__(self, db, Paper, Course, Module, Area):
        self.db, self.Paper, self.Course, self.Module, self.Area = db, Paper, Course, Module, Area

    def text_match(self, column, pattern):
        return func.lower(func.coalesce(cast(column, Text), '')).like(pattern, escape='\\')

    def array_match(self, column, pattern):
        # Search decoded elements, including JSON-escaped Chinese on SQLite.
        if self.db.engine.dialect.name == 'sqlite':
            values = func.json_each(column).table_valued('value')
        elif self.db.engine.dialect.name == 'postgresql':
            values = func.json_array_elements_text(column).table_valued('value').render_derived()
        else:
            raise ValueError('Unsupported search database.')
        return exists(select(1).select_from(values).where(self.text_match(values.c.value, pattern)))

    def providers(self, q):
        P, C, M, A = self.Paper, self.Course, self.Module, self.Area
        escaped = q.lower().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        pattern = '%' + escaped + '%'

        def candidate(kind, model, titles, text_fields, array_fields=(), visibility=None, parent=None, priority=0):
            titles_match = or_(*(self.text_match(col, pattern) for col in titles))
            match = or_(titles_match, *(self.text_match(col, pattern) for col in text_fields),
                        *(self.array_match(col, pattern) for col in array_fields))
            rank = case((or_(*(func.lower(col) == q.lower() for col in titles)), 0),
                        (or_(*(self.text_match(col, escaped + '%') for col in titles)), 1),
                        (titles_match, 2), else_=3)
            query = select(literal(kind).label('kind'), model.id.label('entity_id'),
                           func.lower(model.title if hasattr(model, 'title') else model.name).label('title_order'),
                           rank.label('rank'), literal(priority).label('type_order'))
            if parent is not None:
                query = query.join(parent, model.course_id == parent.id)
            return query.where(and_(model.status == 'published', match,
                                    visibility if visibility is not None else literal(True)))

        return [candidate('papers', P, [P.title], [P.journal, P.abstract, P.doi], [P.authors, P.keywords, P.topics]),
                candidate('courses', C, [C.title, C.title_zh], [C.description], priority=1),
                candidate('modules', M, [M.title, M.title_zh], [M.description, M.learning_focus, M.category],
                          visibility=C.status == 'published', parent=C, priority=2),
                candidate('research', A, [A.name], [A.overview], [A.subtopics], priority=3)]

    @staticmethod
    def excerpt(value):
        value = ' '.join((value or '').split())
        return value if len(value) <= 260 else value[:257].rstrip() + '…'

    def serialize(self, kind, row):
        route_slug = lambda slug: quote(slug, safe='')
        common = dict(type=kind, key=f'{kind}:{row.slug}', title=row.name if kind == 'research' else row.title)
        if kind == 'papers':
            return dict(common, slug=row.slug, summary=self.excerpt(row.abstract), route='/papers/' + route_slug(row.slug),
                        metadata=dict(authors=row.authors, year=row.year, journal=row.journal))
        if kind == 'courses':
            return dict(common, slug=row.slug, titleZh=row.title_zh, summary=self.excerpt(row.description),
                        route='/course/' + route_slug(row.slug), metadata={})
        if kind == 'modules':
            return dict(common, key=f'modules:{row.course.slug}/{row.slug}', courseSlug=row.course.slug,
                        moduleSlug=row.slug, titleZh=row.title_zh, summary=self.excerpt(row.learning_focus or row.description),
                        route=f'/course/{route_slug(row.course.slug)}/modules/{route_slug(row.slug)}',
                        metadata=dict(number=row.number, category=row.category, durationHours=row.duration_hours, courseTitle=row.course.title))
        return dict(common, code=row.code, slug=row.slug, name=row.name, summary=self.excerpt(row.overview),
                    route='/research/' + route_slug(row.slug), metadata={})

    def search(self, params):
        candidates = union_all(*self.providers(params['q'])).subquery()
        counts = dict.fromkeys(SEARCH_TYPES[1:], 0)
        for kind, count in self.db.session.execute(select(candidates.c.kind, func.count()).group_by(candidates.c.kind)):
            counts[kind] = count
        total = sum(counts.values()) if params['type'] == 'all' else counts[params['type']]
        query = select(candidates)
        if params['type'] != 'all':
            query = query.where(candidates.c.kind == params['type'])
        rows = self.db.session.execute(query.order_by(candidates.c.rank, candidates.c.title_order,
            candidates.c.type_order, candidates.c.entity_id).limit(params['perPage']).offset((params['page'] - 1) * params['perPage'])).mappings().all()
        hydrated = {}
        for kind, Model in [('papers', self.Paper), ('courses', self.Course), ('modules', self.Module), ('research', self.Area)]:
            ids = [r['entity_id'] for r in rows if r['kind'] == kind]
            if not ids:
                continue
            statement = select(Model).where(Model.id.in_(ids))
            if kind == 'modules':
                statement = statement.options(joinedload(Model.course))
            for entity in self.db.session.execute(statement).scalars():
                if entity.status == 'published' and (kind != 'modules' or entity.course.status == 'published'):
                    hydrated[(kind, entity.id)] = entity
        return dict(items=[self.serialize(r['kind'], hydrated[(r['kind'], r['entity_id'])]) for r in rows
                           if (r['kind'], r['entity_id']) in hydrated],
                    **params, total=total, totalPages=ceil(total / params['perPage']), counts=counts)
