// TEST ONLY: exercise the actual URL parser and origin validator without APIs or storage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../node_modules/typescript');
function load(file, imports = {}) {
  const filename = path.join(__dirname, '../src/', file), mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports: mod.exports, URLSearchParams, require: name => imports[name] || {} }, { filename });
  return mod.exports;
}
const api = load('api/search.ts');
const { makeSearchOrigin: make, readSearchOrigin: read, validateSearchOrigin: validate, withSearchOrigin: href, searchReturn: back } = load('components/search/searchOrigin.ts', { '../../api/search': api });
const anon = { status: 'anonymous', user: null };
const user = { status: 'authenticated', user: { id: 7, role: 'student', isActive: true } };
const encode = value => '?' + new URLSearchParams({ searchOrigin: JSON.stringify(value) });
const origin = make(new URLSearchParams('q=brain&type=papers&page=2'), user);
test('real Search URL model roundtrips q/type/page and only /search', () => {
  assert.equal(back(read(encode(origin), user)).path, '/search?q=brain&type=papers&page=2');
  for (const type of api.SEARCH_TYPES) assert.equal(back(make(new URLSearchParams({ q: '学习 & brain?', type, page: '10000' }), user)).path, api.searchPath('学习 & brain?', type, 10000));
});
test('only actual browser query keys accepted; API-only perPage and unknown filters rejected', () => {
  for (const extra of ['&perPage=12', '&filter=private', '&q=other', '&returnTo=https://evil.example']) assert.equal(make(new URLSearchParams('q=brain&type=papers&page=2' + extra), user), null);
});
test('external, protocol-relative, javascript and management destinations cannot become a return path', () => {
  for (const pathname of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/manage/papers', '/search/extra', '/search?x=y', '/search#fragment']) assert.equal(validate({ ...origin, pathname }, user), null);
  for (const key of ['returnTo', 'url', 'filter', 'token', '__proto__']) assert.equal(validate(JSON.parse(JSON.stringify(origin).slice(0, -1) + `,"${key}":"bad"}`), user), null);
});
test('malformed, repeated and oversized origin rejected', () => {
  for (const search of ['', '?searchOrigin=null', '?searchOrigin=%7Bbroken', '?searchOrigin=[]', '?searchOrigin=' + 'x'.repeat(1501), encode(origin) + '&searchOrigin={}']) assert.equal(read(search, user), null);
});
test('query/type/page validation reuses SearchPage rules', () => {
  for (const patch of [{ q: '' }, { q: 'x'.repeat(201) }, { q: 'bad\nquery' }, { type: 'paper' }, { type: 'private' }, { page: 0 }, { page: 1.2 }, { page: '2' }, { page: 10001 }]) assert.equal(validate({ ...origin, ...patch }, user), null);
});
test('account/role/status change invalidates old context', () => {
  for (const auth of [anon, { ...user, user: { ...user.user, id: 8 } }, { ...user, user: { ...user.user, role: 'teacher' } }, { ...user, user: { ...user.user, isActive: false } }, { status: 'loading' }, { status: 'unavailable' }]) assert.equal(read(encode(origin), auth), null);
});
test('anonymous public search supported, authenticated-only Hub origin rejected', () => {
  assert.ok(make(new URLSearchParams('q=brain&type=all'), anon));
  assert.equal(make(new URLSearchParams('q=brain&type=hub'), anon), null);
  assert.equal(read(encode(make(new URLSearchParams('q=brain'), anon)), user), null);
});
test('detail destination and current selector/hash preserved; only context added', () => {
  const result = href('/course/test/modules/one?resource=3#viewer', origin);
  const url = new URL(result, 'https://example.test');
  assert.equal(url.pathname, '/course/test/modules/one'); assert.equal(url.hash, '#viewer'); assert.equal(url.searchParams.get('resource'), '3');
  assert.equal(back(read(url.search, user)).path, '/search?q=brain&type=papers&page=2');
  assert.equal(href('/papers/test', null), '/papers/test');
});
