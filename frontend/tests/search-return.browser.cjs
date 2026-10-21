// TEST ONLY. Isolated browser contexts and mocked APIs; never starts Flask or writes a database.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5184', output = 'tmp/nav-fix-d/browser';
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
async function fixture(role = 'student') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const state = { role, id: 901, failSearch: false, denied: null, resource: false };
  await context.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, q = u.searchParams;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ account: state.id, path: p + u.search, method: req.method() });
    let json, status = 200;
    if (p === '/api/auth/me') json = state.role === 'anonymous' ? { authenticated: false, user: null } : { authenticated: true, user: { id: state.id, role: state.role, username: 'TEST ONLY ' + state.id, email: 'nav@example.test', isActive: true } };
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
async function search(page, item, query = 'brain') {
  const url = '/search?' + new URLSearchParams({ q: query, type: item.type, page: '2' });
  await goto(page, url);
  await page.locator('.global-search-list').getByRole('link', { name: item.title, exact: true }).click();
  await back(page).waitFor();
  ok(`${item.key}: original detail destination`, new URL(page.url()).pathname === item.route);
  return url;
}
async function returned(page, url, label) {
  await page.waitForURL(base + url);
  await page.locator('#global-search-query').waitFor();
  ok(`${label}: query/type/page restored`, relative(page) === url && await page.locator('#global-search-query').inputValue() === new URL(base + url).searchParams.get('q'));
  await page.locator('.global-search-count').waitFor();
  ok(`${label}: active type and page restored`, await page.getByRole('link', { current: 'page' }).count() >= 1 && await page.getByText('Page 2 of 2', { exact: true }).isVisible());
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  const { createServer } = await import('../node_modules/vite/dist/node/index.js');
  server = await createServer({ root: path.resolve('frontend'), server: { host: '127.0.0.1', port: 5184, strictPort: true } }); await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const f = await fixture(), { page } = f;
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const item of items) {
      const url = await search(page, item, 'brain & 学习');
      if (width === 1440) { await page.reload(); await back(page).waitFor(); ok(`${item.key}: refresh preserves return context`, (await back(page).getAttribute('href')) === url); }
      ok(`${item.key} ${width}: one Search back control`, await back(page).count() === 1);
      const control = back(page); await control.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      const layout = await control.evaluate(el => ({ focus: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, height: el.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth > innerWidth }));
      ok(`${item.key} ${width}: focus/44px/no overflow`, layout.focus && layout.outline !== 'none' && layout.height >= 44 && !layout.overflow);
      await page.screenshot({ path: path.join(output, `${item.key.replace(':', '-')}-${width}.png`), fullPage: true });
      await page.keyboard.press('Enter'); await returned(page, url, `${item.key} ${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const paperUrl = await search(page, items[0]);
  const detail = relative(page), newTab = await f.context.newPage();
  await goto(newTab, detail); await back(newTab).waitFor(); ok('new tab URL preserves Search context', await back(newTab).getAttribute('href') === paperUrl); await newTab.close();
  // Existing non-Search business links must not inherit a previous Search origin.
  await goto(page, items[0].route); await page.getByRole('link', { name: /Back to Paper Library/ }).waitFor(); ok('direct Paper: semantic fallback', await back(page).count() === 0);
  await goto(page, items[1].route); await page.locator('.co-module').first().click(); await page.getByRole('link', { name: /Back to Course/ }).waitFor(); ok('Course to Module: no Search origin', await back(page).count() === 0);
  await page.getByRole('link', { name: 'Open Paper Reading Workspace →', exact: true }).click();
  await page.getByRole('link', { name: /Back to Module/ }).waitFor(); ok('Module to Paper: original return context retained', await back(page).count() === 0);
  for (const [type, item] of [['paper', items[0]], ['module', items[2]]]) {
    await goto(page, '/bookmarks'); await page.locator(`[data-folder-toggle="${type}"]`).click();
    await page.getByRole('link', { name: 'Open ' + item.title, exact: true }).click();
    await page.getByRole('link', { name: /Back to (Paper Library|Course)/ }).waitFor(); ok(`Bookmark to ${type}: no Search origin`, await back(page).count() === 0);
  }
  // Resource selection must keep the current module's Search back context.
  f.state.resource = true;
  const moduleSearch = await search(page, items[2]); await page.getByRole('button', { name: /TEST ONLY Resource/ }).click();
  await page.reload(); await back(page).waitFor(); ok('Module selector retains Search origin', await back(page).getAttribute('href') === moduleSearch); f.state.resource = false;
  for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/manage/papers']) {
    await goto(page, items[0].route + '?' + new URLSearchParams({ returnTo: bad, searchOrigin: JSON.stringify({ v: 1, pathname: bad, q: 'brain', type: 'papers', page: 2, accountId: 901, role: 'student' }) }));
    await page.getByRole('link', { name: /Back to Paper Library/ }).waitFor(); ok(`malicious origin ${bad}: fallback`, await back(page).count() === 0);
  }
  const valid = JSON.parse(new URL(base + detail).searchParams.get('searchOrigin'));
  await goto(page, items[0].route + '?' + new URLSearchParams({ searchOrigin: JSON.stringify({ ...valid, filter: 'private' }) }));
  await page.getByRole('link', { name: /Back to Paper Library/ }).waitFor(); ok('unknown origin key rejected', await back(page).count() === 0);
  for (const item of [items[0], items[2], items[3], ...items.slice(4)]) {
    await search(page, item);
    const target = relative(page), p = item.type === 'hub' ? item.metadata.kind === 'faculty' ? '/api/hub/entries/101' : `/api/hub/${item.metadata.kind}/entries/${item.id}` : item.type === 'papers' ? '/api/papers/' + paper.slug : item.type === 'modules' ? `/api/courses/${course.slug}/modules/${modules[0].slug}` : '/api/research-areas/' + area.slug;
    f.state.denied = p; await goto(page, target); await page.getByRole('heading', { name: /Paper Not Found|Module not found|Research area not found|Resource not available|Update not available|Discussion unavailable/ }).first().waitFor();
    await back(page).waitFor(); ok(`${item.key}: unavailable still allows safe return`, (await back(page).getAttribute('href')).startsWith('/search?')); f.state.denied = null;
  }
  await goto(page, '/search?q=TEST+ONLY+EMPTY&type=all&page=1'); await page.getByRole('heading', { name: /No results found/ }).waitFor(); ok('zero results unchanged', true);
  f.state.failSearch = true; await goto(page, '/search?q=brain&type=all&page=2'); await page.getByRole('heading', { name: 'Search unavailable' }).waitFor(); f.state.failSearch = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.locator('.global-search-list').waitFor(); ok('real Search failure and retry', true);
  await goto(page, '/search?q=brain&type=all&page=2&filter=private'); await page.getByRole('heading', { name: 'Invalid search parameters' }).waitFor(); ok('unknown Search URL key still invalid', true);
  await search(page, items[0]); f.state.id = 902; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'TEST ONLY 902', exact: true }).waitFor(); await page.getByRole('link', { name: /Back to Paper Library/ }).waitFor(); ok('account switch rejects prior account Search context', await back(page).count() === 0);
  // Search Back still passes through the existing NAV-FIX-B dirty form guard.
  const discussionSearch = await search(page, items[6]); await page.getByRole('button', { name: 'Report thread', exact: true }).click(); await page.getByLabel('Reason', { exact: true }).fill('TEST ONLY unsaved report');
  await back(page).click(); await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); ok('Search Back preserves NAV-FIX-B keep editing', await page.getByLabel('Reason', { exact: true }).inputValue() === 'TEST ONLY unsaved report');
  await back(page).click(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click(); await returned(page, discussionSearch, 'dirty report discard');
  // Navbar continues to emit the same q/type/page URL model.
  await goto(page, items[0].route);
  const openSearch = page.getByRole('button', { name: 'Open search', exact: true });
  if (await openSearch.count()) await openSearch.click();
  await page.getByLabel('Search scientific topics', { exact: true }).fill('brain'); await page.getByLabel('Search scientific topics', { exact: true }).press('Enter');
  await page.waitForURL(base + '/search?q=brain&type=all&page=1'); ok('Navbar Search URL format unchanged', true);
  const a = await fixture('anonymous');
  for (const item of items.slice(0, 4)) { const url = await search(a.page, item); await back(a.page).click(); await returned(a.page, url, 'anonymous ' + item.key); }
  await goto(a.page, '/search?q=brain&type=hub&page=1'); await a.page.getByRole('heading', { name: 'Sign in to search Innovation Hub' }).waitFor(); ok('anonymous Hub Search still denied', true);
  await goto(a.page, items[4].route); await a.page.waitForURL('**/login'); ok('direct Hub route remains authentication protected', true);
  ok('no unhandled browser exceptions', errors.length === 0); ok('all API requests mocked', unknown.length === 0);
  ok('browsing/navigation caused zero writes', calls.every(call => call.method === 'GET'));
  await f.context.close(); await a.context.close();
}
run().catch(async error => { console.error(error); process.exitCode = 1; await debug?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); }).finally(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, unknown, calls }, null, 2));
  await browser?.close(); await server?.close(); console.log(JSON.stringify({ checks: checks.length, errors, unknown }));
});
