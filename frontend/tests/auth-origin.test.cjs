// TEST ONLY. Pure short-lived Auth return contracts; no API, credentials or persistence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const ts = require('../node_modules/typescript');
const filename = path.join(__dirname, '../src/components/auth/authOrigin.ts'), mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(source, { exports: mod.exports, URL, URLSearchParams }, { filename });
const { safeAuthPath: safe, authLoginState: make, loginReturn: back, validateAuthOrigin: validate } = mod.exports;
const location = { pathname: '/manage/hub/industry/9', search: '?managementOrigin=TEST', hash: '#revision' };
test('actual protected and public feature routes retain query and hash', () => {
  for (const pathname of ['/bookmarks', '/my-learning', '/progress', '/innovation-hub', '/innovation-hub/faculty/1', '/innovation-hub/industry/2', '/innovation-hub/discussions/3', '/innovation-hub/discussions/manage/3', '/manage', '/manage/hub', '/manage/hub/industry', '/manage/hub/discussions', '/manage/papers/2/preview', '/manage/papers/2/edit', '/admin/users', '/admin/audit-log', '/change-password', '/course/brain/modules/one', '/research/neuroscience', '/papers/one', '/']) {
    const target = { ...location, pathname };
    assert.equal(back(make(target)).path, pathname + target.search + target.hash);
  }
});
test('Search and Management query contexts remain independent intact strings', () => {
  for (const search of ['?searchOrigin=' + encodeURIComponent(JSON.stringify({ pathname: '/search', q: '脑 & science' })), '?managementOrigin=' + encodeURIComponent(JSON.stringify({ kind: 'reports', status: 'resolved', page: 2 }))]) {
    assert.equal(back(make({ ...location, search })).path, location.pathname + search + location.hash);
  }
});
test('public Paper Module return state preserved; other history state omitted', () => {
  const result = back(make({ pathname: '/papers/one', search: '?resource=4', hash: '#reader', state: { from: '/course/brain/modules/one?paper=2', password: 'MUST NOT COPY', token: 'MUST NOT COPY' } }));
  assert.equal(result.state.from, '/course/brain/modules/one?paper=2');
  assert.equal(Object.keys(result.state).join(), 'from');
  assert.equal(JSON.stringify(result).includes('MUST NOT COPY'), false);
});
test('external, scheme, absolute, protocol relative, backslash and control targets rejected', () => {
  for (const target of ['https://evil.example', 'https://auth-context.invalid/bookmarks', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'data:text/plain,x', '/%5cevil.example', '/papers/%2f%2fevil', '/papers/%00', '/papers/\nfoo', '/papers/%ZZ', '/papers/../login', '/papers/%2e%2e/login', ' /bookmarks']) {
    assert.equal(safe(target), null, target); assert.equal(back({ from: target }).path, '/', target);
  }
});
test('Login loops, credential/API/file endpoints and unknown routes rejected', () => {
  for (const target of ['/login', '/login?from=/bookmarks', '/forgot-password', '/reset-password?token=secret', '/accept-invitation?token=secret', '/api/auth/logout', '/api/files/2', '/uploads/private.pdf', '/not-a-route', '/admin/new-route', '/manage/papers/2/delete']) assert.equal(safe(target), null, target);
});
test('sensitive and redirect query keys rejected rather than copied', () => {
  for (const key of ['password', 'token', 'secret', 'next', 'returnTo', 'redirect']) assert.equal(safe('/bookmarks?' + key + '=x'), null);
});
test('invalid structured origin cannot downgrade to a legacy from value', () => {
  assert.equal(back({ authOrigin: { ...location, v: 1, extra: 'bad' }, from: '/admin/users' }).path, '/');
  for (const value of [null, [], {}, { ...location, v: 2 }, { ...location, v: 1, search: 'bad' }, { ...location, v: 1, hash: 'bad' }, { ...location, v: 1, state: { from: '//evil.example' } }, { ...location, v: 1, state: { from: '/bookmarks', privateBody: 'bad' } }]) assert.equal(validate(value), null);
});
test('no state defaults Home; legacy safe callers compatible; notices do not manufacture origin', () => {
  assert.equal(back(null).path, '/'); assert.equal(back({}).path, '/');
  assert.equal(back({ from: '/bookmarks?view=paper#saved' }).path, '/bookmarks?view=paper#saved');
  const result = make(location, 'management'); assert.equal(result.managementRequired, true); assert.equal(back(result).path, location.pathname + location.search + location.hash);
  assert.equal(back(make({ pathname: '/login', search: '', hash: '' }, 'tutor')).path, '/');
});
