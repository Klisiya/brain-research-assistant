"""Explicit, exact-value retirement of known demo content; never run at startup."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import click
from sqlalchemy import MetaData, Table, select, text


def fingerprint(value):
    """Compare decoded field values without trimming, case folding or fuzzy matching."""
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def retired_content():
    return json.loads((Path(__file__).parent / 'retired_content_fingerprints.json').read_text(encoding='utf-8'))


def clean_content(connection, *, apply=False, manifest=None):
    """Caller owns the transaction. Lock rows and recheck values before every write.

    Only manifest selectors and exact field fingerprints are eligible. Unknown rows
    and differing values are reported, never inferred from their academic subject.
    History tables and content/revision versions are never rewritten. Changed
    metadata gets a fresh updated_at token so stale editors cannot restore it.
    """
    manifest = retired_content() if manifest is None else manifest
    report = {'matched': [], 'preserved': [], 'empty': [], 'missing': [], 'changed': 0}
    metadata = MetaData()
    tables = {name: Table(name, metadata, autoload_with=connection)
              for name in {item['table'] for item in manifest}}
    known_ids = {name: set() for name in tables}
    for item in manifest:
        table = tables[item['table']]
        predicate = [table.c[key] == value for key, value in item['selector'].items()]
        if item.get('course_slug'):
            courses = tables['courses']
            predicate.append(table.c.course_id.in_(select(courses.c.id).where(
                courses.c.slug == item['course_slug'])))
        query = select(table).where(*predicate)
        rows = connection.execute(query.with_for_update() if apply else query).mappings().all()
        if not rows:
            report['missing'].append({'table': table.name, 'selector': item['selector']})
        for row in rows:
            known_ids[table.name].add(row['id'])
            changes = {}
            for field, rule in item['fields'].items():
                value = row[field]
                entry = {'table': table.name, 'id': row['id'], 'field': field,
                         'fingerprint': fingerprint(value)}
                if entry['fingerprint'] == rule['sha256']:
                    report['matched'].append(entry)
                    changes[field] = rule['empty']
                elif value in (None, '', []):
                    report['empty'].append(entry)
                else:
                    report['preserved'].append(entry)
            # Only a completely unchanged demo may leave public circulation.
            # Edited Papers keep their publication status for manual review.
            retirement = item.get('retire_when', {})
            if retirement and all(fingerprint(row[k]) == v for k, v in retirement.items()):
                if row['status'] != 'archived':
                    changes['status'] = 'archived'
                    report['matched'].append({'table': table.name, 'id': row['id'],
                                              'field': 'status', 'reason': 'Exact demo record.'})
            elif retirement:
                for field, expected in retirement.items():
                    if field not in item['fields'] and row[field] not in (None, '', []) and fingerprint(row[field]) != expected:
                        report['preserved'].append({'table': table.name, 'id': row['id'], 'field': field,
                                                    'reason': 'Different demo metadata; left untouched.'})
            if apply and changes:
                now = datetime.now(timezone.utc).replace(tzinfo=None)
                changes['updated_at'] = max(now, row['updated_at'] + timedelta(microseconds=1))
                connection.execute(table.update().where(table.c.id == row['id']).values(**changes))
                report['changed'] += len(changes) - 1
    for name, table in tables.items():
        for row in connection.execute(select(table.c.id)):
            if row.id not in known_ids[name]:
                report['preserved'].append({'table': name, 'id': row.id, 'field': '*',
                                            'reason': 'Unknown identity; left untouched.'})
    return report


def register_content_authority_cli(app, db):
    @app.cli.command('cleanup-content-authority')
    @click.option('--apply', is_flag=True, help='Apply exact matches atomically; default is a read-only audit.')
    def cleanup_content_authority(apply):
        with db.engine.connect() as connection:
            try:
                if apply and connection.dialect.name == 'sqlite':
                    connection.execute(text('BEGIN IMMEDIATE'))
                result = clean_content(connection, apply=apply)
                if apply:
                    connection.commit()
                else:
                    connection.rollback()
            except Exception:
                connection.rollback()
                raise
        click.echo(json.dumps(result, indent=2))
