// TEST ONLY. Isolated browser contexts and mocked APIs; never starts Flask or writes a database.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5185', output = 'tmp/nav-fix-e/browser';
const checks = [], errors = [], unknown = [], calls = [];
let browser, server, debug;
const stamp = '2026-10-21T12:00:00Z';
const paper = { id: 41, slug: 'test-only-paper', title: 'TEST ONLY Paper', authors: [], year: null, journal: null, publicationType: '', difficulty: '', estimatedReadingMinutes: 0, topics: [], abstract: '', learningObjectives: [], keywords: [], featured: false, openAccess: false, externalUrl: null, resourceCategory: '', createdAt: stamp, updatedAt: stamp, publishedAt: stamp, status: 'published', createdBy: { id: 901, username: 'TEST ONLY', role: 'teacher' }, updatedById: 901 };
const modules = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, number: i + 1, slug: `test-only-${i + 1}`, title: `TEST ONLY Module ${i + 1}`, titleZh: `仅测试单元 ${i + 1}`, durationHours: 3, category: '', description: '', learningFocus: '', coverVariant: '' }));
const course = { id: 1, slug: 'test-only-course', title: 'TEST ONLY Course', titleZh: null, description: '', moduleCount: 12, totalHours: 36, categories: [], modules };
const area = { id: 1, slug: 'neuroscience', code: 'RA-01', name: 'Neuroscience', overview: '', subtopics: [], brainRegionSlugs: [], sortOrder: 1 };
const revision = title => ({ id: 1, number: 1, title, body: 'TEST ONLY neutral fixture.', attachments: [], sourceName: null, sourceUrl: null, sourceDate: null, publishedAt: stamp });
const items = [
  { key: 'papers:41', type: 'papers', slug: paper.slug, title: paper.title, summary: '', route: '/papers/' + paper.slug, metadata: { authors: [], year: null, journal: null } },
  { key: 'courses:1', type: 'courses', slug: course.slug, title: course.title, titleZh: null, summary: '', route: '/course/' + course.slug, metadata: {} },
  { key: 'modules:1', type: 'modules', courseSlug: course.slug, moduleSlug: modules[0].slug, title: modules[0].title, titleZh: modules[0].titleZh, summary: '', route: `/course/${course.slug}/modules/${modules[0].slug}`, metadata: { number: 1, category: '', durationHours: 3, courseTitle: course.title } },
  { key: 'research:1', type: 'research', slug: area.slug, code: area.code, name: area.name, title: area.name, summary: '', route: '/research/' + area.slug, metadata: {} },
  ...['faculty', 'industry', 'discussions'].map((kind, i) => ({ key: 'hub:' + (101 + i), type: 'hub', id: 101 + i, title: 'TEST ONLY ' + kind, summary: '', route: `/innovation-hub/${kind}/${101 + i}`, metadata: { kind } })),
];
function ok(label, value) { assert.ok(value, label); checks.push(label); }
function relative(page) { const u = new URL(page.url()); return u.pathname + u.search + u.hash; }
const back = page => page.getByRole('link', { name: /Back to search results/ });
async function goto(page, url) { await page.goto(base + url); }
async function fixture(role = 'anonymous') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const state = { role, id: 901, failSearch: false, denied: null, resource: false, nextRole: 'student', failLogin: false };
  await context.addInitScript(() => sessionStorage.setItem('brain-home-intro-seen', '1'));
  await context.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, q = u.searchParams;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ role: state.role, account: state.id, path: p + u.search, method: req.method() });
    let json, status = 200;
    if (p === '/api/auth/me') json = state.role === 'anonymous' ? { authenticated: false, user: null } : { authenticated: true, user: { id: state.id, role: state.role, username: 'TEST ONLY ' + state.id, email: 'nav@example.test', isActive: true } };
    else if (p === '/api/auth/csrf') json = { csrfToken: 'TEST-ONLY-AUTH' };
    else if (p === '/api/auth/login') {
      if (state.failLogin) { status = 401; json = { error: 'TEST ONLY invalid credentials' }; }
      else { state.role = state.nextRole; json = { authenticated: true, user: { id: state.id, username: 'TEST ONLY ' + state.id, email: 'auth@example.test', role: state.role, isActive: true } }; }
    } else if (p === '/api/auth/logout') { state.role = 'anonymous'; json = { success: true }; }
    else if (p === '/api/auth/invitation-details') json = { username: 'TEST ONLY invitation' };
    else if (['/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/accept-invitation', '/api/auth/change-password'].includes(p)) {
      if (p.endsWith('reset-password') || p.endsWith('change-password')) state.role = 'anonymous';
      json = { success: true };
    } else if (p === '/api/chat') { status = 401; json = { code: 'AUTH_REQUIRED', login_url: 'https://evil.example/login' }; }
    else if (p === '/api/admin/users') json = { users: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 }, filters: { q: '', role: null, status: null, sort: 'newest' } };
    else if (p === '/api/admin/invitations') json = { invitations: [], pagination: { page: 1, perPage: 20, total: 0, totalPages: 0 } };
    else if (p === '/api/learning/enrollments') json = { enrollments: [] };
    else if (p === '/api/courses') json = { courses: [course] };
    else if (p === '/api/courses/manage') json = { courses: [] };
    else if (p === '/api/research-areas/manage') json = { areas: [] };
    else if (p === '/api/courses/brain-science-and-brain-inspired-intelligence') json = { course };
    else if (p === '/api/hub/entries' || p === '/api/hub/industry/entries') {
      const kind = p.includes('/industry/') ? 'industry' : 'faculty', id = kind === 'industry' ? 102 : 101;
      json = { entries: [{ id, kind, status: 'pending', ownerId: 901, version: 1, working: { ...revision('TEST ONLY ' + kind), state: 'pending' }, published: null }], page: Number(q.get('page') || 1), total: 25, totalPages: 3 };
    } else if (p === '/api/hub/entries/101/manage' || p === '/api/hub/industry/entries/102/manage') {
      const kind = p.includes('/industry/') ? 'industry' : 'faculty', id = kind === 'industry' ? 102 : 101;
      json = { entry: { id, kind, status: 'draft', ownerId: 901, version: 1, working: { ...revision('TEST ONLY ' + kind), state: 'draft' }, published: null } };
    } else if (p.endsWith('/history') && p.startsWith('/api/hub/')) json = { events: [] };
    else if (p === '/api/papers/manage/41/preview') json = { paper: { ...paper, preview: true } };
    else if (p === '/api/search') {
      if (state.failSearch) { status = 503; json = { error: 'TEST ONLY Search unavailable' }; }
      else if (state.role === 'anonymous' && q.get('type') === 'hub') { status = 401; json = { error: 'Sign in required' }; }
      else {
        const visible = items.filter(x => state.role !== 'anonymous' || x.type !== 'hub');
        const selected = visible.filter(x => q.get('type') === 'all' || x.type === q.get('type'));
        const empty = q.get('q') === 'TEST ONLY EMPTY', total = empty ? 0 : 24;
        json = { q: q.get('q'), type: q.get('type'), page: Number(q.get('page')), perPage: 12, total, totalPages: Math.ceil(total / 12), items: empty || Number(q.get('page')) > 2 ? [] : selected, counts: { papers: 6, courses: 3, modules: 3, research: 3, hub: state.role === 'anonymous' ? 0 : 9 } };
      }
    } else if (state.denied === p) { status = 404; json = { error: 'TEST ONLY inaccessible' }; }
    else if (p === '/api/courses/' + course.slug) json = { course };
    else if (p.endsWith('/resources') && p.startsWith('/api/courses/')) json = { resources: state.resource ? [{ id: 71, displayName: 'TEST ONLY Resource', attachmentType: 'other', version: 1, sortOrder: 1, externalUrl: null, downloadUrl: null, fileSize: null, description: null }] : [] };
    else if (p.endsWith('/papers') && p.startsWith('/api/courses/')) json = { readings: [{ relationId: 1, readingType: 'required', sortOrder: 1, paper }] };
    else if (p.startsWith(`/api/courses/${course.slug}/modules/`)) json = { course, module: modules[0] };
    else if (p.startsWith('/api/learning/courses/')) json = { enrollment: null };
    else if (p === '/api/papers/' + paper.slug) json = { paper };
    else if (p.endsWith('/attachments') && p.startsWith('/api/papers/')) json = { attachments: [] };
    else if (p === '/api/research-areas/' + area.slug) json = { area, papers: [], modules: [], resources: [], brainRegions: [], hubContent: [] };
    else if (p === '/api/research-areas') json = { areas: [area] };
    else if (p === '/api/learning/bookmarks') json = { bookmarks: [
      { id: 1, targetType: 'paper', createdAt: stamp, available: true, target: { ...paper } },
      { id: 2, targetType: 'module', createdAt: stamp, available: true, target: { ...modules[0], courseSlug: course.slug, courseTitle: course.title } },
    ] };
    else if (p.endsWith('/notes') || p.endsWith('/highlights')) json = { notes: [], highlights: [], resources: [] };
    else if (p === '/api/learning/papers') json = { readings: [] };
    else if (p.startsWith('/api/learning/papers/')) json = { reading: { status: 'not_started', startedAt: null, lastActivityAt: null, selfCompletedAt: null, resources: [], unavailableHistory: [] } };
    else if (p === '/api/hub/entries/101') json = { entry: { id: 101, kind: 'faculty', status: 'published', published: revision('TEST ONLY faculty') } };
    else if (p === '/api/hub/industry/entries/102') json = { entry: { id: 102, kind: 'industry', status: 'published', published: revision('TEST ONLY industry') } };
    else if (p === '/api/hub/discussions/entries/103') json = { entry: { id: 103, type: 'thread', threadId: null, author: 'TEST ONLY author', canManage: false, published: revision('TEST ONLY discussions') } };
    else if (p === '/api/hub/discussions/entries/103/replies') json = { entries: [], page: 1, total: 0, totalPages: 0 };
    else { status = 404; unknown.push(p); json = { error: 'TEST ONLY missing mock' }; }
    await route.fulfill({ status, json });
  });
  const page = await context.newPage(); debug = page; page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  return { page, context, state };
}

async function signIn(f, role = 'student') {
  f.state.nextRole = role;
  await f.page.getByRole('heading', { name: 'Welcome Back', exact: true }).waitFor();
  await f.page.getByLabel('Email', { exact: true }).fill('auth@example.test');
  await f.page.getByLabel('Password', { exact: true }).fill('TEST ONLY long passphrase');
  await f.page.getByRole('button', { name: 'Sign In', exact: true }).click();
}
async function expectTarget(f, target, label) {
  await f.page.waitForURL(base + target);
  await f.page.locator('h1').first().waitFor();
  ok(label + ': exact route/query/hash', relative(f.page) === target);
  ok(label + ': Login replaced', await f.page.getByRole('heading', { name: 'Welcome Back', exact: true }).count() === 0);
}
async function expire(f) {
  f.state.role = 'anonymous';
  await f.page.evaluate(() => window.dispatchEvent(new Event('brain-research:session-expired')));
  await f.page.waitForURL('**/login');
  ok('session expiry: no dirty confirmation loop', await f.page.getByRole('dialog').count() === 0);
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  const { createServer } = await import('../node_modules/vite/dist/node/index.js');
  server = await createServer({ root: path.resolve('frontend'), server: { host: '127.0.0.1', port: 5185, strictPort: true } }); await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-gpu'] });
  for (const [width, role] of [[390, 'student'], [820, 'teacher'], [1440, 'admin']]) {
    const f = await fixture(); await f.page.setViewportSize({ width, height: 1000 });
    await goto(f.page, '/about'); await goto(f.page, '/bookmarks?type=paper#saved'); await f.page.waitForURL('**/login');
    const submit = f.page.getByRole('button', { name: 'Sign In', exact: true }); await submit.waitFor(); await submit.focus(); await f.page.keyboard.press('Tab'); await f.page.keyboard.press('Shift+Tab');
    ok(`Login ${width}: visible keyboard focus/no overflow/44px`, await submit.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none' && el.getBoundingClientRect().height >= 44 && document.documentElement.scrollWidth <= innerWidth));
    await f.page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
    await signIn(f, role); await expectTarget(f, '/bookmarks?type=paper#saved', `Bookmarks ${width}`);
    await f.page.goBack(); await f.page.waitForURL(base + '/about'); ok(`Back after gated login ${width}: no Login loop`, relative(f.page) === '/about');
    await f.context.close();
  }
  const cases = [
    ['/my-learning#my-learning-main', 'student'], ['/progress#progress-main', 'student'],
    ['/innovation-hub?view=industry&page=2#updates', 'student'], ['/innovation-hub/faculty/101#materials', 'student'],
    ['/manage/hub?scope=mine&page=2#faculty-101', 'teacher'], ['/manage/hub/industry?scope=mine&page=2#industry-102', 'teacher'],
    ['/manage/hub/industry?scope=review&page=2', 'admin'], ['/admin/users#users', 'admin'],
    ['/manage/papers/41/preview#paper-main', 'teacher'], ['/change-password#security', 'student'],
  ];
  for (const [target, role] of cases) {
    const f = await fixture(); await goto(f.page, target); await f.page.waitForURL('**/login');
    const stored = await f.page.evaluate(() => history.state.usr.authOrigin);
    ok(`${target}: gated state includes full target`, stored.pathname + stored.search + stored.hash === target);
    await f.page.reload(); await signIn(f, role); await expectTarget(f, target, target);
    await f.context.close();
  }
  for (const [target, role] of [['/admin/users', 'student'], ['/manage/hub', 'student']]) {
    const f = await fixture(); await goto(f.page, target); await f.page.waitForURL('**/login'); await signIn(f, role);
    await f.page.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor(); ok('role rechecked at ' + target, relative(f.page) === target);
    const id = calls.length; await f.page.reload(); await f.page.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor(); ok('403 stable/no Login loop ' + target, relative(f.page) === target && calls.slice(id).filter(c => c.path.startsWith('/api/auth/me')).length <= 2);
    await f.context.close();
  }
  const retry = await fixture(); await goto(retry.page, '/bookmarks#saved'); await retry.page.waitForURL('**/login');
  retry.state.failLogin = true; await signIn(retry); await retry.page.getByRole('alert').waitFor();
  ok('wrong password retains origin', await retry.page.evaluate(() => history.state.usr.authOrigin.pathname === '/bookmarks'));
  retry.state.failLogin = false; await signIn(retry); await expectTarget(retry, '/bookmarks#saved', 'correct retry'); await retry.context.close();
  for (const state of [undefined, { from: 'https://evil.example' }, { from: 'javascript:alert(1)' }, { from: 'data:text/html,x' }, { from: '//evil.example' }, { from: '/api/auth/logout' }, { authOrigin: { v: 1, pathname: '/login', search: '', hash: '' } }]) {
    const f = await fixture(); await goto(f.page, '/login?returnTo=https://evil.example&next=javascript:alert(1)');
    if (state) await f.page.evaluate(value => history.replaceState({ usr: value, idx: history.state.idx, key: 'TEST-ONLY' }, ''), state);
    await f.page.reload(); await signIn(f); await expectTarget(f, '/', 'invalid/absent origin safe Home'); await f.context.close();
  }
  const explicit = await fixture(); await goto(explicit.page, '/papers/' + paper.slug);
  await explicit.page.locator('.navbar .login-nav-button').click(); await signIn(explicit); await expectTarget(explicit, '/', 'Navbar explicit Login'); await explicit.context.close();
  // Authentication restores the target URL; Search then independently restores its own result context.
  const search = await fixture('student'); await goto(search.page, '/search?q=brain&type=hub&page=2');
  await search.page.locator('.global-search-list').getByRole('link', { name: 'TEST ONLY faculty', exact: true }).click();
  await back(search.page).waitFor(); const searchDetail = relative(search.page); await expire(search); await signIn(search); await expectTarget(search, searchDetail, 'Search detail after reauth');
  await back(search.page).click(); await search.page.waitForURL(base + '/search?q=brain&type=hub&page=2'); ok('NAV-FIX-D preserved through Login', true); await search.context.close();
  const hubSearch = await fixture(); await goto(hubSearch.page, '/search?q=brain&type=hub&page=2#results');
  await hubSearch.page.getByRole('link', { name: 'Sign in', exact: true }).click(); await signIn(hubSearch); await expectTarget(hubSearch, '/search?q=brain&type=hub&page=2#results', 'gated Hub search'); await hubSearch.context.close();
  const managed = await fixture('admin'); await goto(managed.page, '/manage/hub/industry?scope=review&page=2');
  await managed.page.locator('.faculty-list h3 a').first().click(); await managed.page.getByRole('heading', { name: 'Manage Industry Update', exact: true }).waitFor();
  const manager = relative(managed.page); await managed.page.getByLabel('Title', { exact: true }).fill('TEST ONLY unsaved local change');
  await expire(managed); await signIn(managed, 'admin'); await expectTarget(managed, manager, 'Management detail after reauth');
  await managed.page.getByRole('link', { name: /Back to review queue/ }).click(); await managed.page.waitForURL(u => u.pathname === '/manage/hub/industry' && u.searchParams.get('scope') === 'review' && u.searchParams.get('page') === '2'); ok('NAV-FIX-A queue/page preserved', true);
  await managed.context.close();
  // Legacy Module -> Paper state survives an optional feature sign-in on the public reader.
  const reading = await fixture(); await goto(reading.page, items[2].route + '?paper=1');
  await reading.page.getByRole('link', { name: 'Open Paper Reading Workspace →', exact: true }).click();
  await reading.page.getByRole('link', { name: 'Sign in to record reading', exact: true }).click(); await signIn(reading); await reading.page.getByRole('link', { name: /Back to Module/ }).waitFor();
  ok('Module reading state retained across Login', (await reading.page.getByRole('link', { name: /Back to Module/ }).getAttribute('href')) === items[2].route + '?paper=1'); await reading.context.close();
  // Existing logout Home navigation prevents reuse of the preceding admin task on explicit Login.
  const switched = await fixture('admin'); await goto(switched.page, '/admin/users'); await switched.page.getByRole('button', { name: 'TEST ONLY 901', exact: true }).click();
  await switched.page.getByRole('menuitem', { name: 'Sign Out', exact: true }).click(); await switched.page.waitForURL(base + '/');
  switched.state.id = 902; await switched.page.locator('.navbar .login-nav-button').click(); await signIn(switched, 'student'); await expectTarget(switched, '/', 'logout then different-role explicit Login'); await switched.context.close();
  // Password and invitation pages stay separate, never authenticate via origin metadata.
  const credentials = await fixture(); await goto(credentials.page, '/bookmarks'); await credentials.page.waitForURL('**/login');
  await credentials.page.getByRole('link', { name: 'Forgot password?', exact: true }).click(); await credentials.page.getByLabel('Email', { exact: true }).fill('auth@example.test');
  await credentials.page.getByRole('button', { name: 'Send Reset Link', exact: true }).click(); await credentials.page.getByText(/If an eligible account exists/).waitFor();
  await credentials.page.getByRole('link', { name: 'Sign In', exact: true }).click(); ok('Forgot returns Login without private access', relative(credentials.page) === '/login');
  for (const [target, button] of [['/reset-password?token=TEST-ONLY-TOKEN', 'Update Password'], ['/accept-invitation?token=TEST-ONLY-TOKEN', 'Create Account']]) {
    await goto(credentials.page, target); await credentials.page.getByLabel('New password', { exact: true }).fill('TEST ONLY new long passphrase'); await credentials.page.getByLabel('Confirm password', { exact: true }).fill('TEST ONLY new long passphrase');
    if (button === 'Create Account') await credentials.page.getByLabel('Display name', { exact: true }).fill('TEST ONLY invitation');
    await credentials.page.getByRole('button', { name: button, exact: true }).click(); await credentials.page.getByRole('link', { name: 'Sign In', exact: true }).waitFor();
    ok(target + ': remains account workflow', new URL(credentials.page.url()).pathname === target.split('?')[0] && credentials.state.role === 'anonymous');
    await credentials.page.getByRole('link', { name: 'Sign In', exact: true }).click(); await credentials.page.waitForURL(base + '/login');
  }
  await credentials.context.close();
  const change = await fixture(); await goto(change.page, '/change-password'); await change.page.waitForURL('**/login'); await signIn(change);
  await change.page.getByLabel('Current password', { exact: true }).fill('TEST ONLY original long passphrase'); await change.page.getByLabel('New password', { exact: true }).fill('TEST ONLY new long passphrase'); await change.page.getByLabel('Confirm password', { exact: true }).fill('TEST ONLY new long passphrase');
  await change.page.getByRole('button', { name: 'Update Password', exact: true }).click(); await change.page.waitForURL(base + '/login'); ok('Change password retains existing reauthentication rule', true); await change.context.close();
  const publicPage = await fixture();
  for (const target of ['/', items[0].route, items[1].route, items[2].route, items[3].route]) { await goto(publicPage.page, target); await publicPage.page.locator('h1').first().waitFor(); ok('public route remains public ' + target, new URL(publicPage.page.url()).pathname === target); }
  await goto(publicPage.page, '/#ai-section'); await publicPage.page.getByLabel('Ask a question', { exact: true }).fill('TEST ONLY question'); await publicPage.page.getByRole('button', { name: 'Send question', exact: true }).click(); await publicPage.page.waitForURL(base + '/login');
  ok('Tutor rejects external login URL and preserves task anchor', await publicPage.page.evaluate(() => history.state.usr.authOrigin.hash === '#ai-section'));
  await signIn(publicPage); await expectTarget(publicPage, '/#ai-section', 'Tutor reauth'); await publicPage.context.close();
  ok('no unhandled browser errors', errors.length === 0); ok('all APIs explicitly mocked', unknown.length === 0);
  ok('zero automatic learning writes', !calls.some(c => c.path.startsWith('/api/learning/') && c.method !== 'GET'));
}
run().catch(async error => { console.error(error); process.exitCode = 1; await debug?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); }).finally(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, unknown, calls }, null, 2));
  await browser?.close(); await server?.close(); console.log(JSON.stringify({ checks: checks.length, errors, unknown }));
});
