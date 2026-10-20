// TEST ONLY. Every API is mocked in browser memory. Never starts Flask or touches a database.
// Run from repository root with Playwright available via NODE_PATH.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.NAV_TEST_ORIGIN || 'http://127.0.0.1:5178';
const output = process.env.NAV_TEST_OUTPUT || 'tmp/nav-fix-a/browser';
const checks = [], errors = [], calls = [], unknown = [];
let browser, server, course;
const now = '2026-10-18T12:00:00Z';
const revision = (title, state = 'pending') => ({ id: 1, number: 1, title, body: 'TEST ONLY neutral fixture.', state, sourceName: 'TEST ONLY', sourceUrl: null, sourceDate: null, attachments: [], publishedAt: now });
const paper = { id: 41, slug: 'test-only-paper', title: 'TEST ONLY Paper', authors: [], year: null, journal: null, publicationType: '', difficulty: '', estimatedReadingMinutes: 0, topics: [], abstract: '', learningObjectives: [], keywords: [], featured: false, openAccess: false, externalUrl: null, resourceCategory: '', createdAt: now, updatedAt: now, publishedAt: now, status: 'published', createdBy: { id: 901, username: 'TEST ONLY', role: 'teacher' }, updatedById: 901 };
const user = (role, id = 901) => ({ id, username: 'TEST ONLY ' + role, email: role + '@example.test', role, isActive: true });
function ok(label, value) { assert.ok(value, label); checks.push(label); }
const relative = p => { const u = new URL(p.url()); return u.pathname + u.search + u.hash; };
async function click(p, role, name) { await p.getByRole(role, { name, exact: true }).first().click(); }
async function goto(p, url) { await p.goto(base + url); }
function list(entries, requestedPage, size = 12) {
  const page = Number(requestedPage || 1), totalPages = Math.ceil(entries.length / size);
  return { entries: entries.slice((page - 1) * size, page * size), page, total: entries.length, totalPages };
}
async function fixture(role = 'admin') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const state = { role, id: 901, delay: 0, industry: [], faculty: [], discussions: [], reports: [], paperPages: 3, paperStatus: 'published', forbidden: false };
  for (let i = 0; i < 25; i++) {
    for (const kind of ['industry', 'faculty']) state[kind].push({ id: (kind === 'industry' ? 201 : 101) + i, kind, status: 'pending', ownerId: 901, submittedById: 901, version: 1, published: null, working: revision(`TEST ONLY ${kind} ${i + 1}`) });
    state.discussions.push({ id: 301 + i, type: 'thread', threadId: null, author: 'TEST ONLY learner', canManage: true, isAuthor: false, status: 'pending', version: 1, published: null, working: revision(`TEST ONLY Thread ${i + 1}`) });
    for (const [index, status] of ['open', 'resolved', 'dismissed'].entries()) state.reports.push({ id: 501 + index * 100 + i, targetId: 301 + i, originalTargetId: 301 + i, threadId: null, targetType: 'thread', targetState: 'pending', reporter: 'TEST ONLY learner', reason: 'TEST ONLY reason', detail: null, status, version: 1, createdAt: now, resolvedAt: null, resolvedBy: null });
  }
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method(), q = url.searchParams;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ role: state.role, id: state.id, path: p + url.search, method: m });
    let body, status = 200;
    if (p === '/api/auth/me') body = state.role === 'anonymous' ? { authenticated: false, user: null } : { authenticated: true, user: user(state.role, state.id) };
    else if (p === '/api/auth/csrf') body = { csrfToken: 'TEST-ONLY-NAV' };
    else if (p === '/api/auth/logout') { state.role = 'anonymous'; body = { success: true }; }
    else if (p === '/api/courses/manage') body = { courses: [] };
    else if (p === '/api/courses') body = { courses: [course] };
    else if (p === '/api/courses/' + course.slug) body = { course };
    else if (p.startsWith('/api/courses/') && p.includes('/modules/')) { if (p.endsWith('/resources')) body = { resources: [] }; else if (p.endsWith('/papers')) body = { readings: [{ relationId: 1, readingType: 'required', sortOrder: 1, paper }] }; else body = { course, module: course.modules[0] }; }
    else if (p.startsWith('/api/learning/courses/')) body = { enrollment: null };
    else if (p === '/api/research-areas/manage') body = { areas: [] };
    else if (p === '/api/learning/bookmarks') body = { bookmarks: [] };
    else if (p.endsWith('/notes') || p.endsWith('/highlights')) body = { notes: [], highlights: [], resources: [] };
    else if (p.startsWith('/api/learning/papers/')) body = { reading: { status: 'not_started', startedAt: null, selfCompletedAt: null, lastActivityAt: null, resources: [], unavailableHistory: [] } };
    else if (p === '/api/papers') body = {
      papers: [paper], highlights: [], libraryTotal: 1,
      pagination: { page: 1, perPage: 12, total: 1, totalPages: 1 },
      filters: { q: q.get('q') || '', course: null, module: null, topic: null, author: null, year: null, view: 'all', difficulty: null, publicationType: null, resourceCategory: null, featured: null, sort: 'recommended' },
      availableFilters: { topics: [], authors: [], years: [], difficulties: [], publicationTypes: [], resourceCategories: [] },
    };
    else if (p === '/api/papers/manage') {
      const page = Number(q.get('page') || 1);
      body = { papers: page <= state.paperPages ? [{ ...paper, status: state.paperStatus }] : [], pagination: { page, perPage: 20, total: state.paperPages * 20, totalPages: state.paperPages }, filters: { q: q.get('q') || '', status: q.get('status') === 'all' ? null : q.get('status'), sort: q.get('sort') || 'recommended' } };
    if (q.get('q') === 'TEST ONLY EMPTY') body = { ...body, papers: [], pagination: { page, perPage: 20, total: 0, totalPages: 0 } };
    } else if (p.endsWith('/attachments') && p.startsWith('/api/papers')) body = { attachments: [] };
    else if (p === '/api/papers/manage/41/preview') body = { paper: { ...paper, status: state.paperStatus, preview: true } };
    else if (p === '/api/papers/manage/41') body = { paper: { ...paper, status: state.paperStatus } };
    else if (p === '/api/papers/test-only-paper') body = { paper };
    else if (p.startsWith('/api/hub/discussions')) {
      const suffix = p.slice('/api/hub/discussions'.length);
      if (suffix === '/reports') body = list(state.reports.filter(x => q.get('status') === 'all' || x.status === q.get('status')), q.get('page'));
      else if (/^\/reports\/\d+\/(resolve|dismiss)$/.test(suffix)) {
        const report = state.reports.find(x => x.id === Number(suffix.split('/')[2])); report.status = suffix.endsWith('/resolve') ? 'resolved' : 'dismissed'; report.version++; body = { report };
      } else if (suffix === '/entries') {
        const scope = q.get('scope');
        body = list(state.discussions.filter(x => scope !== 'review' || x.working?.state === 'pending').map(x => scope === 'published' ? { ...x, published: x.working, working: undefined } : x), q.get('page'));
      } else if (/^\/entries\/\d+(\/manage)?$/.test(suffix)) {
        body = { entry: state.discussions.find(x => x.id === Number(suffix.split('/')[2])) };
        if (state.forbidden) { status = 403; body = { error: 'TEST ONLY denied' }; }
      } else if (suffix.endsWith('/replies')) body = list([], 1);
      else if (suffix.endsWith('/history')) body = { entries: [], page: 1, total: 0, totalPages: 0 };
      else { unknown.push(p); status = 404; body = { error: 'TEST ONLY missing mock' }; }
    } else if (p.startsWith('/api/hub/industry/entries') || p.startsWith('/api/hub/entries')) {
      const kind = p.includes('/industry/') ? 'industry' : 'faculty', root = kind === 'industry' ? '/api/hub/industry/entries' : '/api/hub/entries', suffix = p.slice(root.length), id = Number(suffix.split('/')[1]);
      const entry = state[kind].find(x => x.id === id);
      if (!suffix) {
        const scope = q.get('scope');
        let entries = state[kind];
        if (scope === 'review' && kind === 'industry') entries = entries.filter(x => x.working?.state === 'pending');
        if (scope === 'published') entries = entries.map(x => ({ ...x, published: revision(x.working?.title || 'TEST ONLY published', 'approved') }));
        body = list(entries, q.get('page'));
        if (state.failList) { status = 503; body = { error: 'TEST ONLY transient list failure' }; }
      } else if (suffix.endsWith('/history')) body = { events: [] };
      else if (m === 'POST' && /\/(approve|reject)$/.test(suffix)) {
        if (suffix.endsWith('/approve')) { entry.published = { ...entry.working, state: 'approved' }; entry.working = null; entry.status = 'published'; }
        else { entry.working.state = 'rejected'; entry.status = 'rejected'; }
        entry.version++; body = { entry };
      } else {
        body = { entry };
        if (state.forbidden) { status = 403; body = { error: 'TEST ONLY denied' }; }
      }
    } else { unknown.push(p); status = 404; body = { error: 'TEST ONLY missing mock' }; }
    if (state.delay && !p.startsWith('/api/auth/')) await new Promise(resolve => setTimeout(resolve, state.delay));
    await route.fulfill({ status, json: body }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, state };
}
const returnLink = (p, label) => p.getByRole('link', { name: new RegExp('^← ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first();
async function enterHub(p, kind, scope = 'review', page = 2) {
  const path = kind === 'faculty' ? '/manage/hub' : '/manage/hub/industry';
  await goto(p, `${path}?scope=${scope}&page=${page}`);
  const title = p.locator('.faculty-list h3 a').first(); await title.waitFor(); await title.click();
  await p.getByRole('heading', { name: kind === 'faculty' ? 'Manage Faculty Resource' : 'Manage Industry Update', exact: true }).waitFor();
  await p.locator('.faculty-status').first().waitFor();
}
async function assertReturn(p, label, pathname, params) {
  const link = returnLink(p, label); await link.waitFor(); await link.click();
  await p.waitForURL(url => url.pathname === pathname && Object.entries(params).every(([k, v]) => url.searchParams.get(k) === String(v)));
  await p.locator('[data-management-row]').first().waitFor();
  ok(`${label}: ${pathname} ${JSON.stringify(params)}`, true);
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  const seed = JSON.parse(await fs.readFile('project/migrations/data/r4a_course.json', 'utf8'));
  course = { ...seed.course, id: 1, moduleCount: 12, totalHours: 36, categories: [], modules: seed.modules.map((m, i) => ({ ...m, id: i + 1 })) };
  if (!process.env.NAV_TEST_ORIGIN) {
    const { createServer } = await import('../node_modules/vite/dist/node/index.js');
    server = await createServer({ root: path.resolve('frontend'), server: { host: '127.0.0.1', port: 5178, strictPort: true } }); await server.listen();
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const a = await fixture(), t = await fixture('teacher');
  // Real list links generate the context; we don't fake a good context into these flows.
  await enterHub(a.page, 'industry');
  const managerURL = a.page.url();
  await a.page.reload();
  await assertReturn(a.page, 'Back to review queue', '/manage/hub/industry', { scope: 'review', page: 2 });
  ok('selected Industry row receives focus on return', await a.page.evaluate(() => document.activeElement?.getAttribute('data-management-row')?.startsWith('industry-')));
  await enterHub(a.page, 'industry'); await click(a.page, 'button', 'Approve & Publish'); await a.page.getByRole('dialog').getByRole('button', { name: 'Approve & Publish', exact: true }).click();
  await a.page.getByText('Approved and published.', { exact: true }).waitFor();
  await assertReturn(a.page, 'Back to review queue', '/manage/hub/industry', { scope: 'review', page: 2 });
  await enterHub(a.page, 'industry'); await a.page.getByLabel('Rejection reason').fill('TEST ONLY rejection'); await click(a.page, 'button', 'Reject'); await a.page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await a.page.getByText('Update saved.', { exact: true }).waitFor();
  await assertReturn(a.page, 'Back to review queue', '/manage/hub/industry', { scope: 'review', page: 2 });
  await enterHub(t.page, 'industry', 'mine'); await assertReturn(t.page, 'Back to my updates', '/manage/hub/industry', { scope: 'mine', page: 2 });
  for (const [scope, label] of [['mine', 'Back to my resources'], ['review', 'Back to all resources / review']]) {
    await enterHub(a.page, 'faculty', scope); await assertReturn(a.page, label, '/manage/hub', { scope, page: 2 });
  }
  await goto(a.page, '/innovation-hub?view=faculty&page=2'); await a.page.locator('.faculty-list h3 a').first().click();
  await assertReturn(a.page, 'Back to published resources', '/innovation-hub', { view: 'faculty', page: 2 });
  // Source list scopes survive even when published first enters a reader, then its existing Manage link.
  for (const scope of ['review', 'mine', 'all', 'published']) {
    await goto(a.page, `/manage/hub/discussions?scope=${scope}&page=2`);
    await a.page.locator('.faculty-list h2 a').first().click();
    if (scope === 'published') await click(a.page, 'link', 'Manage thread →');
    const label = { review: 'Back to review queue', mine: 'Back to my discussions', all: 'Back to all discussions', published: 'Back to published threads' }[scope];
    await assertReturn(a.page, label, '/manage/hub/discussions', { scope, page: 2 });
  }
  for (const status of ['open', 'resolved', 'dismissed']) {
    await goto(a.page, `/manage/hub/discussions?scope=reports&status=${status}&page=2`);
    await a.page.getByRole('link', { name: 'Review target content →', exact: true }).first().click();
    await a.page.reload();
    await assertReturn(a.page, 'Back to reports', '/manage/hub/discussions', { scope: 'reports', status, page: 2 });
    ok(`report selected context restored ${status}`, await a.page.evaluate(() => document.activeElement?.getAttribute('data-management-row')?.startsWith('reports-')));
  }
  await goto(a.page, '/manage/hub/discussions?scope=reports&status=resolved&page=2');
  await a.page.getByRole('link', { name: 'Review target content →', exact: true }).first().click();
  await click(a.page, 'link', 'Reports queue');
  await a.page.waitForURL(url => url.searchParams.get('status') === 'resolved' && url.searchParams.get('page') === '2');
  ok('existing Reports queue shortcut also preserves status/page', true);
  // Resolve the last report on the now-obsolete page 3. Actual mock response drives clamping.
  await goto(a.page, '/manage/hub/discussions?scope=reports&status=open&page=3');
  await click(a.page, 'button', 'Resolve report');
  await a.page.waitForURL(url => url.searchParams.get('page') === '2');
  await a.page.locator('.discussion-reply').first().waitFor(); ok('report resolution clamps last page without losing status', new URL(a.page.url()).searchParams.get('status') === 'open');
  await goto(a.page, '/manage/hub/industry?scope=review&page=99');
  await a.page.waitForURL(url => url.searchParams.get('page') === '2'); ok('obsolete Industry page clamps using successful response', true);
  await goto(a.page, '/manage/hub?scope=review&page=99'); await a.page.waitForURL(url => url.searchParams.get('page') === '3'); ok('Faculty stale page clamps', true);
  await goto(a.page, '/manage/hub/discussions?scope=review&page=99'); await a.page.waitForURL(url => url.searchParams.get('page') === '3'); ok('Discussion stale page clamps', true);
  const boundary = await fixture();
  await enterHub(boundary.page, 'industry', 'review', 3); await click(boundary.page, 'button', 'Approve & Publish'); await boundary.page.getByRole('dialog').getByRole('button', { name: 'Approve & Publish', exact: true }).click();
  await boundary.page.getByText('Approved and published.', { exact: true }).waitFor(); await returnLink(boundary.page, 'Back to review queue').click();
  await boundary.page.waitForURL(url => url.searchParams.get('scope') === 'review' && url.searchParams.get('page') === '2'); ok('approval removes last page and returns to last valid review page', true);
  boundary.state.failList = true; await goto(boundary.page, '/manage/hub/industry?scope=review&page=3'); await boundary.page.getByRole('heading', { name: 'Industry Updates unavailable', exact: true }).waitFor();
  ok('failed response never clamps to a fabricated empty first page', new URL(boundary.page.url()).searchParams.get('page') === '3'); boundary.state.failList = false; await click(boundary.page, 'button', 'Retry');
  await boundary.page.waitForURL(url => url.searchParams.get('page') === '2'); ok('real Retry clamps only after successful data', true); await boundary.context.close();
  // New tab gets exactly the same safe link context; no memory store is required.
  const tab = await a.context.newPage(); await goto(tab, managerURL.slice(base.length));
  await returnLink(tab, 'Back to review queue').waitFor(); ok('new tab retains queue return context', true); await tab.close();
  const paperList = '/manage/papers?q=TEST+ONLY&status=published&sort=title&page=2';
  await goto(a.page, paperList); await a.page.locator('.management-row-actions a').filter({ hasText: /^Edit$/ }).first().click();
  await a.page.getByRole('button', { name: /Back to papers management/, exact: false }).waitFor();
  await a.page.reload(); await click(a.page, 'link', 'Preview saved version');
  ok('editor opens protected saved-version preview', new URL(a.page.url()).pathname === '/manage/papers/41/preview');
  await click(a.page, 'link', 'Back to Edit');
  await a.page.getByRole('button', { name: /Back to papers management/ }).click();
  await a.page.waitForURL(url => url.pathname === '/manage/papers' && url.searchParams.get('page') === '2');
  let url = new URL(a.page.url()); ok('Paper editor/managed preview restores q/status/sort/page', url.searchParams.get('q') === 'TEST ONLY' && url.searchParams.get('status') === 'published' && url.searchParams.get('sort') === 'title');
  await click(a.page, 'link', 'View published paper');
  await a.page.locator('.pr-back').waitFor();
  ok('View published paper opens public reading workspace in the same tab', new URL(a.page.url()).pathname === '/papers/test-only-paper' && a.context.pages().length === 1);
  await a.page.locator('.pr-back').click(); await a.page.waitForURL(/\/manage\/papers/);
  url = new URL(a.page.url()); ok('published Paper return preserves management page and filters', url.searchParams.get('page') === '2' && url.searchParams.get('q') === 'TEST ONLY' && url.searchParams.get('status') === 'published' && url.searchParams.get('sort') === 'title');
  for (const status of ['draft', 'archived']) {
    a.state.paperStatus = status; await goto(a.page, '/manage/papers'); await a.page.locator('.management-row-actions').first().waitFor();
    ok(`${status} has no misleading public action or public Paper URL`, await a.page.getByRole('link', { name: 'View published paper', exact: true }).count() === 0 && await a.page.locator('.management-row-actions a[href^="/papers/"]').count() === 0);
    await click(a.page, 'link', 'Edit'); await click(a.page, 'link', 'Preview saved version');
    await a.page.getByText(`Preview Mode · ${status[0].toUpperCase() + status.slice(1)}`, { exact: true }).waitFor();
    ok(`${status} saved preview uses protected endpoint and saved title`, new URL(a.page.url()).pathname === '/manage/papers/41/preview' && await a.page.getByRole('heading', { name: paper.title, exact: true }).count() === 1);
    await click(a.page, 'link', 'Back to Edit'); await a.page.getByLabel('Title', { exact: true }).waitFor();
    ok(`${status} preview Back to Edit`, new URL(a.page.url()).pathname === '/manage/papers/41/edit');
  }
  a.state.paperStatus = 'published';
  await goto(a.page, '/manage/papers/new'); await a.page.getByRole('heading', { name: 'Create Paper', exact: true }).waitFor();
  ok('unsaved new Paper has no fake preview or published-view action', await a.page.getByRole('link', { name: /Preview saved version|View published paper/ }).count() === 0);
  await goto(a.page, '/papers'); const libraryLink = a.page.getByRole('link', { name: 'View Paper', exact: true }); await libraryLink.waitFor(); const libraryReturn = relative(a.page); await libraryLink.click();
  await a.page.locator('.pr-back').waitFor();
  ok('Paper Library still opens reading workspace with exact Library return', new URL(a.page.url()).pathname === '/papers/test-only-paper' && await a.page.locator('.pr-back').getAttribute('href') === libraryReturn);
  await goto(a.page, paperList); a.state.paperPages = 1; await a.page.reload(); await a.page.waitForURL(url => url.searchParams.get('page') === '1'); ok('Paper last page adjusts while preserving filters', new URL(a.page.url()).searchParams.get('q') === 'TEST ONLY');
  await goto(a.page, '/manage/papers'); await a.page.locator('#management-paper-search').fill('TEST ONLY FILTER'); await a.page.locator('.paper-management-filters button[type="submit"]').click();
  await a.page.locator('.paper-management-filters select').nth(0).selectOption('published'); await a.page.locator('.paper-management-filters select').nth(1).selectOption('title');
  await a.page.locator('.management-row-actions a').filter({ hasText: /^Edit$/ }).first().click(); await a.page.getByRole('button', { name: /Back to papers management/ }).click();
  await a.page.locator('#management-paper-search').waitFor(); ok('Paper actual filter controls survive editor return', await a.page.locator('#management-paper-search').inputValue() === 'TEST ONLY FILTER' && await a.page.locator('.paper-management-filters select').nth(0).inputValue() === 'published' && await a.page.locator('.paper-management-filters select').nth(1).inputValue() === 'title');
  await goto(a.page, '/manage/papers?q=TEST+ONLY+EMPTY&status=draft&page=2'); await a.page.waitForURL(url => url.searchParams.get('page') === '1'); await a.page.getByRole('heading', { name: 'No matching papers', exact: true }).waitFor(); ok('empty filtered collection stays a truthful page-one empty state', true);
  // Direct access keeps original semantic parents, and invalid URL targets never navigate externally.
  await goto(a.page, '/manage/hub/industry/201'); ok('Industry direct fallback', await a.page.getByRole('link', { name: '← Industry Updates', exact: true }).getAttribute('href') === '/manage/hub/industry');
  await goto(a.page, '/manage/hub/101'); ok('Faculty direct fallback', await a.page.getByRole('link', { name: '← Faculty Resources', exact: true }).getAttribute('href') === '/manage/hub');
  await goto(a.page, '/innovation-hub/discussions/manage/301'); ok('Discussion direct fallback', await a.page.getByRole('link', { name: '← Learner Discussions', exact: true }).getAttribute('href') === '/innovation-hub?view=discussions');
  await goto(a.page, '/manage/papers/41/edit'); await a.page.getByRole('button', { name: 'Back to Papers Management', exact: false }).waitFor(); ok('Paper direct fallback', await a.page.getByRole('button', { name: 'Back to Papers Management', exact: false }).count() === 1);
  for (const malicious of ['https://evil.example.com', JSON.stringify({ v: 1, accountId: 901, role: 'admin', kind: 'industry', scope: 'review', page: 2, returnTo: '//evil.example.com' })]) {
    await goto(a.page, '/manage/hub/industry/201?managementOrigin=' + encodeURIComponent(malicious));
    await a.page.waitForURL(url => !url.searchParams.has('managementOrigin'));
    ok('malicious origin removed with stable local fallback', await a.page.getByRole('link', { name: '← Industry Updates', exact: true }).getAttribute('href') === '/manage/hub/industry');
  }
  // A stale account-bound origin is removed immediately after auth refresh, before it can be reused.
  await goto(a.page, managerURL.slice(base.length)); await returnLink(a.page, 'Back to review queue').waitFor();
  a.state.id = 902; await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.waitForURL(url => !url.searchParams.has('managementOrigin'));
  ok('account switch drops old queue context', await a.page.getByRole('link', { name: '← Industry Updates', exact: true }).getAttribute('href') === '/manage/hub/industry');
  a.state.id = 901;
  const forged = { v: 1, accountId: 901, role: 'teacher', kind: 'reports', scope: 'reports', status: 'resolved', page: 2 };
  await goto(t.page, '/innovation-hub/discussions/manage/301?managementOrigin=' + encodeURIComponent(JSON.stringify(forged)));
  await t.page.waitForURL(url => !url.searchParams.has('managementOrigin'));
  ok('teacher cannot inherit admin report origin', await t.page.getByRole('link', { name: /Back to reports/ }).count() === 0);
  await goto(t.page, '/manage/hub/discussions?scope=reports&status=resolved&page=2'); await t.page.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor(); ok('existing admin route guard remains', true);
  a.state.forbidden = true; await goto(a.page, managerURL.slice(base.length)); await a.page.getByRole('heading', { name: 'Access denied', exact: true }).waitFor();
  ok('valid origin cannot bypass denied content API', await a.page.getByRole('heading', { name: 'Manage Industry Update', exact: true }).count() === 0); a.state.forbidden = false;
  await goto(a.page, paperList); await a.page.locator('.management-row-actions a').filter({ hasText: /^Edit$/ }).first().waitFor();
  a.state.id = 902; await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.waitForURL(url => url.searchParams.get('account') === '902:admin');
  ok('account switch clears previous Paper query/status/page', new URL(a.page.url()).searchParams.get('q') === '' && new URL(a.page.url()).searchParams.get('page') === '1'); a.state.id = 901;
  const moduleURL = `/course/${course.slug}/modules/${course.modules[0].slug}`;
  await goto(t.page, moduleURL + '?paper=1'); await click(t.page, 'link', 'Open Paper Reading Workspace →');
  await t.page.locator('.pr-back').waitFor(); const moduleBack = await t.page.locator('.pr-back').getAttribute('href'); await t.page.reload(); await t.page.locator('.pr-back').waitFor();
  ok('existing Module→Paper→Module context survives refresh', moduleBack === moduleURL + '?paper=1' && await t.page.locator('.pr-back').getAttribute('href') === moduleBack);
  await goto(a.page, '/innovation-hub?view=discussions'); await a.page.getByRole('heading', { name: 'Learner Discussions', exact: true }).waitFor();
  ok('Discussion public index retains no self-back or duplicate My link', await a.page.getByRole('link', { name: '← Learner Discussions', exact: true }).count() === 0 && await a.page.getByRole('link', { name: 'My discussions', exact: true }).count() === 0);
  await goto(a.page, '/manage/hub/discussions?scope=reports'); const toolbar = a.page.getByRole('navigation', { name: 'Discussion navigation', exact: true }); await toolbar.waitFor();
  ok('accepted single admin toolbar retained with inline Reports', await toolbar.count() === 1 && await toolbar.getByRole('button').count() === 5 && await a.page.getByRole('heading', { name: 'Discussion Reports', exact: true }).count() === 1);
  for (const width of [1440, 820, 390]) {
    await a.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await goto(a.page, paperList);
    const publishedAction = a.page.getByRole('link', { name: 'View published paper', exact: true });
    await publishedAction.waitFor(); await publishedAction.focus();
    const publishedLayout = await publishedAction.evaluate(el => ({ focus: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, overflow: document.documentElement.scrollWidth > innerWidth }));
    ok(`Paper published action ${width}: accessible name, visible keyboard focus, no overflow`, publishedLayout.focus && publishedLayout.outline !== 'none' && !publishedLayout.overflow && await publishedAction.getAttribute('target') === null);
    await a.page.screenshot({ path: path.join(output, `paper-actions-${width}.png`), fullPage: true });
    await a.page.keyboard.press('Enter'); await a.page.locator('.pr-back').waitFor();
    ok(`Paper published action ${width}: Enter opens public reader`, new URL(a.page.url()).pathname === '/papers/test-only-paper');
    await a.page.locator('.pr-back').click(); await click(a.page, 'link', 'Edit');
    const previewAction = a.page.getByRole('link', { name: 'Preview saved version', exact: true }); await previewAction.waitFor(); await previewAction.focus(); await a.page.keyboard.press('Tab'); await a.page.keyboard.press('Shift+Tab');
    ok(`Paper saved preview ${width}: keyboard focus and no overflow`, await previewAction.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none' && document.documentElement.scrollWidth <= innerWidth));
    await a.page.keyboard.press('Enter'); await a.page.getByText('Preview Mode · Published', { exact: true }).waitFor();
    ok(`Paper saved preview ${width}: Enter opens protected saved version`, new URL(a.page.url()).pathname === '/manage/papers/41/preview');
    for (const [name, start, label] of [
      ['industry', '/manage/hub/industry?scope=review&page=2', 'Back to review queue'],
      ['faculty', '/manage/hub?scope=review&page=2', 'Back to all resources / review'],
      ['reports', '/manage/hub/discussions?scope=reports&status=resolved&page=2', 'Back to reports'],
      ['papers', paperList, 'Back to papers management'],
    ]) {
      await goto(a.page, start);
      if (name === 'reports') await a.page.getByRole('link', { name: 'Review target content →', exact: true }).first().click();
      else if (name === 'papers') await a.page.locator('.management-row-actions a').filter({ hasText: /^Edit$/ }).filter({ visible: true }).first().click();
      else await a.page.locator('.faculty-list h3 a').first().click();
      const control = name === 'papers' ? a.page.getByRole('button', { name: new RegExp(label) }) : returnLink(a.page, label);
      await control.waitFor(); await control.focus(); await a.page.keyboard.press('Tab'); await a.page.keyboard.press('Shift+Tab');
      const layout = await control.evaluate(el => { const r = el.getBoundingClientRect(); return { focus: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, overflow: document.documentElement.scrollWidth > innerWidth, width: r.width, height: r.height }; });
      ok(`${name} ${width}: return 44px target, focus visible and no horizontal overflow`, layout.focus && layout.outline !== 'none' && !layout.overflow && layout.width >= 44 && layout.height >= 44);
      await a.page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
      await a.page.keyboard.press('Enter'); await a.page.waitForURL(url => !url.searchParams.has('managementOrigin')); ok(`${name} ${width}: keyboard return works`, true);
    }
  }
  ok('no unhandled browser exceptions', errors.length === 0);
  ok('all API requests mocked explicitly', unknown.length === 0);
  ok('zero automatic learning mutations', !calls.some(r => /\/api\/learning\//.test(r.path) && !['GET', 'HEAD'].includes(r.method)));
  await a.context.close(); await t.context.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, unknown, calls }, null, 2));
  await browser?.close(); await server?.close(); console.log(JSON.stringify({ checks: checks.length, errors, unknown }));
});
