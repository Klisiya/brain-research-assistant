// Pure navigation contract tests. No API, database, account credentials or browser needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const filename = require('node:path').join(__dirname, '../src/components/management/managementOrigin.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(source, { exports: mod.exports, URLSearchParams, require }, { filename });
const { makeManagementOrigin: make, readManagementOrigin: read, validateManagementOrigin: validate, managementReturn: back, withManagementOrigin: href, readPaperListFilters: paperFilters, MANAGEMENT_ORIGIN: key } = mod.exports;
const admin = { id: 9, role: 'admin', isActive: true };
const teacher = { id: 7, role: 'teacher', isActive: true };
const query = text => new URLSearchParams(text);
const roundtrip = (kind, user, params, selectedId) => {
  const origin = make(user, kind, query(params), selectedId);
  assert.ok(origin);
  const path = href('/manage/example', origin);
  assert.equal(JSON.stringify(read(path.slice(path.indexOf('?')), user, [kind])), JSON.stringify(origin));
  return origin;
};
test('Industry admin review and teacher mine retain page and selected row', () => {
  assert.equal(back(roundtrip('industry', admin, 'scope=review&page=2', 21)).path, '/manage/hub/industry?scope=review&page=2#industry-21');
  assert.equal(back(roundtrip('industry', teacher, 'scope=mine&page=4')).path, '/manage/hub/industry?scope=mine&page=4');
});
test('Faculty scopes preserve their existing all/review semantics, and published parent', () => {
  for (const scope of ['mine', 'review', 'published']) {
    const value = back(roundtrip('faculty', admin, `scope=${scope}&page=2`));
    assert.equal(value.path, scope === 'published' ? '/innovation-hub?view=faculty&page=2' : `/manage/hub?scope=${scope}&page=2`);
  }
});
test('Discussion scopes and report statuses roundtrip independently', () => {
  for (const scope of ['review', 'published', 'mine', 'all']) assert.equal(back(roundtrip('discussions', admin, `scope=${scope}&page=3`)).path, `/manage/hub/discussions?scope=${scope}&page=3`);
  for (const status of ['open', 'resolved', 'dismissed', 'all']) assert.equal(back(roundtrip('reports', admin, `scope=reports&status=${status}&page=2`, 42)).path, `/manage/hub/discussions?scope=reports&status=${status}&page=2#reports-42`);
});
test('Paper search/filter/sort/page survive a link, refresh, and new tab URL', () => {
  const origin = roundtrip('papers', teacher, 'q=neural+network&status=draft&sort=title&page=5');
  const path = back(origin).path, params = query(path.split('?')[1]);
  assert.equal(params.get('q'), 'neural network');
  assert.equal(params.get('status'), 'draft'); assert.equal(params.get('sort'), 'title'); assert.equal(params.get('page'), '5');
  assert.equal(params.get('account'), '7:teacher');
});
test('No origin / malformed JSON / duplicates / oversized context yield fallback', () => {
  for (const value of ['', '?returnTo=https://evil.example.com', `?${key}=https://evil.example.com`, `?${key}=%7B`, `?${key}=${'x'.repeat(1501)}`, `?${key}={}&${key}={}`]) assert.equal(read(value, admin, ['industry']), null);
  assert.equal(href('/manage/hub/industry/21', null), '/manage/hub/industry/21');
});
test('Arbitrary routes, URLs, secrets and unknown keys cannot enter the origin contract', () => {
  const base = make(admin, 'industry', query('scope=review&page=2'));
  for (const extra of [{ returnTo: 'https://evil.example.com' }, { url: '//evil.example.com' }, { path: '/admin/users' }, { token: 'TEST ONLY' }, { body: 'private draft' }, { password: 'TEST ONLY' }, { '__proto__': null, extra: true }]) assert.equal(validate({ ...base, ...extra }, admin, ['industry']), null);
  for (const scope of ['https://evil.example.com', '//evil.example.com', '../users', 'reports', 'review%26page=3']) assert.equal(validate({ ...base, scope }, admin, ['industry']), null);
});
test('Wrong account, changed role, disabled user and unauthorized kind/scope rejected', () => {
  const adminOrigin = make(admin, 'reports', query('scope=reports&status=resolved&page=2'));
  for (const user of [teacher, { ...admin, id: 99 }, { ...admin, role: 'teacher' }, { ...admin, isActive: false }]) assert.equal(validate(adminOrigin, user, ['reports']), null);
  assert.equal(validate(adminOrigin, admin, ['industry']), null);
  for (const kind of ['reports', 'discussions']) assert.equal(make(teacher, kind, query('scope=review')), null);
  assert.equal(make(teacher, 'industry', query('scope=all')), null);
  assert.equal(make({ ...teacher, role: 'student' }, 'faculty', query('scope=published')), null);
});
test('Invalid page/selected ID/status/q/sort values never become destinations', () => {
  const base = make(admin, 'papers', query(''));
  for (const page of [-1, 0, 1.5, 10001, '2', Infinity]) assert.equal(validate({ ...base, page }, admin, ['papers']), null);
  for (const selectedId of [-1, '2', 0, 1.2]) assert.equal(validate({ ...base, selectedId }, admin, ['papers']), null);
  for (const extra of [{ status: 'review' }, { sort: 'custom' }, { q: 'a'.repeat(201) }, { q: '\n' }]) assert.equal(validate({ ...base, ...extra }, admin, ['papers']), null);
});
test('Paper filters are account-bound on generated return URLs', () => {
  const params = query('q=private+filter&status=draft&sort=title&page=4&account=7:teacher');
  assert.equal(paperFilters(params, teacher).q, 'private filter');
  const other = paperFilters(params, admin); assert.equal(other.q, ''); assert.equal(other.page, 1);
  assert.equal(paperFilters(query('q=ok&q=bad'), teacher).q, '');
});
