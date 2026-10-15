/* TEST ONLY fixtures: all API calls are intercepted; no database or uploads are contacted.
 * Run against an isolated frontend with Playwright available via NODE_PATH.
 * Screenshots and results stay in ignored tmp/ui-p2-1.
 */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.UI_P2_ORIGIN || 'http://127.0.0.1:5176';
const output = process.env.UI_P2_OUTPUT || 'tmp/ui-p2-1/browser';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const checks = [], errors = [], writes = [];
let browser;
const kinds = ['paper', 'course', 'module', 'research_area'];
const names = ['Papers', 'Course', 'Modules', 'Research Areas'];
function check(label, value = true) { assert.ok(value, label); checks.push(label); }
function records() {
  const row = (id, kind, title, more = {}) => ({ id, targetType: kind, createdAt: '2026-10-14T00:00:00Z', available: true, target: { id, slug: 'test-only-' + kind + '-' + id, title, ...more } });
  return [
    ...Array.from({ length: 7 }, (_, i) => row(101 + i, 'paper', 'TEST ONLY Paper ' + (i + 1), { authors: ['TEST ONLY Author'], year: 2026, journal: 'TEST ONLY Journal' })),
    { id: 108, targetType: 'paper', createdAt: '2026-10-14T00:00:00Z', available: false, target: null },
    row(201, 'course', 'TEST ONLY Course', { titleZh: null, description: '' }),
    row(301, 'module', 'TEST ONLY Module', { titleZh: 'TEST ONLY 测试单元', number: 1, courseSlug: 'test-only-course', courseTitle: 'TEST ONLY Course' }),
    row(401, 'research_area', 'TEST ONLY Research Area', { code: 'RA-01', overview: '' }),
  ];
}
async function fixtures(context, options = {}) {
  options.rows ??= records(); options.account ??= 901;
  const requests = [];
  await context.route(base + '/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    requests.push({ method, url: url.pathname });
    if (!['GET', 'HEAD'].includes(method)) writes.push({ method, url: url.pathname });
    let status = 200, body;
    if (url.pathname === '/api/auth/me') body = options.anonymous ? { authenticated: false, user: null } : { authenticated: true, user: { id: options.account, role: 'student', username: 'TEST ONLY', email: 'test@example.test', isActive: true } };
    else if (url.pathname === '/api/auth/csrf') body = { csrfToken: 'TEST-ONLY-CSRF' };
    else if (url.pathname === '/api/learning/bookmarks') {
      const account = options.account, captured = structuredClone(options.rows);
      if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
      body = { bookmarks: account === 901 ? captured : [] };
      if (options.failLoad) { status = 503; body = { error: 'TEST ONLY load failure' }; }
    } else if (/^\/api\/learning\/bookmarks\/\d+$/.test(url.pathname) && method === 'DELETE') {
      assert.equal(request.headers()['x-csrf-token'], 'TEST-ONLY-CSRF');
      if (options.failRemove) { status = 503; body = { error: 'TEST ONLY remove failure' }; }
      else { options.rows = options.rows.filter(row => row.id !== Number(url.pathname.split('/').at(-1))); body = { deleted: true }; }
    } else { status = 404; body = { error: 'TEST ONLY unavailable' }; }
    await route.fulfill({ status, json: body }).catch(error => { if (!route.request().failure()) throw error; });
  });
  return requests;
}
function monitor(page) { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); }
const toggle = (page, kind) => page.locator(`[data-folder-toggle="${kind}"]`);
const details = page => page.locator('.bf-details:not([hidden]):not([aria-hidden="true"])');
async function ready(page) { await page.locator('.bf-folder').nth(3).waitFor(); await page.waitForTimeout(700); }
async function layout(page, label) {
  const result = await page.locator('.bw-main').evaluate(main => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    folders: [...main.querySelectorAll('.bf-object')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top }; }),
    actions: [...main.querySelectorAll('.bf-toggle, .bf-details:not([hidden]):not([aria-hidden="true"]) button, .bf-details:not([hidden]):not([aria-hidden="true"]) .bf-document-open')].every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
    nested: [...main.querySelectorAll('*:not(.bf-documents)')].some(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight),
  }));
  check('no overflow / 44px actions / no unexpected nested scroll ' + label, !result.overflow && result.actions && !result.nested && result.folders.every(box => box.left >= 0 && box.right <= page.viewportSize().width));
  return result;
}
async function viewport(width, preference) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: preference, hasTouch: width === 390 });
  const requests = await fixtures(context), page = await context.newPage(); monitor(page);
  await page.goto(base + '/bookmarks'); await ready(page);
  for (let i = 0; i < kinds.length; i++) {
    check(`folder ${names[i]} ${width}/${preference}`, await toggle(page, kinds[i]).innerText() === names[i] + '\n' + (i === 0 ? '8 items' : '1 item'));
    assert.equal(await toggle(page, kinds[i]).getAttribute('aria-expanded'), 'false');
  }
  const closed = await layout(page, 'closed ' + width + '/' + preference);
  check('responsive columns ' + width + '/' + preference, width === 390 ? closed.folders[1].top > closed.folders[0].top : Math.abs(closed.folders[1].top - closed.folders[0].top) < 2);
  check('closed sheets inert ' + width + '/' + preference, await page.locator('.bf-preview').evaluateAll(elements => elements.every(el => el.inert)));
  await page.screenshot({ path: path.join(output, `closed-${width}-${preference}.png`), fullPage: true });
  await toggle(page, 'paper').focus(); await page.keyboard.press('Enter');
  await details(page).waitFor(); await page.waitForTimeout(600);
  check('drawer matches selected accent ' + width + '/' + preference, await details(page).evaluate(el => el.dataset.type === 'paper' && getComputedStyle(el).getPropertyValue('--bf-accent').trim() === getComputedStyle(document.querySelector('.bf-folder[data-open="true"]')).getPropertyValue('--bf-accent').trim()));
  check('other folders recede without blur ' + width + '/' + preference, await page.locator('.bf-folder[data-open="false"] .bf-object').evaluateAll(elements => elements.every(el => Number(getComputedStyle(el).opacity) >= .65 && Number(getComputedStyle(el).opacity) <= .8 && getComputedStyle(el).filter === 'none')));
  check('no repeated visual header or primary Open/Remove buttons ' + width + '/' + preference, await details(page).evaluate(el => !el.innerText.includes('items') && !el.innerText.includes('Open →') && !el.innerText.includes('Close') && !el.innerText.includes('Remove bookmark')));
  check('open / many items / unavailable ' + width + '/' + preference, await details(page).locator('.bf-document').count() === 8 && await details(page).getByRole('heading', { name: 'Unavailable paper' }).count() === 1);
  check('full metadata from fixtures ' + width + '/' + preference, (await details(page).innerText()).includes('TEST ONLY Author · 2026 · TEST ONLY Journal'));
  check('single open folder ' + width + '/' + preference, await page.locator('.bf-folder[data-open="true"]').count() === 1);
  await layout(page, 'open ' + width + '/' + preference);
  const animation = await page.locator('.bf-folder').first().evaluate(el => ({ tilt: getComputedStyle(el.querySelector('.bf-tilt')).transform, front: getComputedStyle(el.querySelector('.bf-front')).transform, running: el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length }));
  if (preference === 'reduce') check('reduced motion static / functional ' + width, animation.tilt === 'none' && animation.front === 'none' && animation.running === 0);
  else check('front hinge animation ' + width, animation.front !== 'matrix(1, 0, 0, 1, 0, 0)');
  await page.screenshot({ path: path.join(output, `open-${width}-${preference}.png`), fullPage: true });
  await details(page).locator('[data-remove-id="108"]').focus();
  check('visible keyboard focus ' + width + '/' + preference, await page.locator('[data-remove-id="108"]').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
  await page.keyboard.press('Escape');
  check('Escape closes / restores focus ' + width + '/' + preference, await details(page).count() === 0 && await toggle(page, 'paper').evaluate(el => document.activeElement === el));
  await page.waitForFunction(() => !document.querySelector('.bf-details:not([hidden])') && [...document.querySelectorAll('.bf-object')].every(el => getComputedStyle(el).opacity === '1'));
  check('closed drawer settles hidden / folder weights restore ' + width + '/' + preference, await page.locator('.bf-details:not([hidden])').count() === 0 && await page.locator('.bf-object').evaluateAll(elements => elements.every(el => getComputedStyle(el).opacity === '1')));
  await page.keyboard.press('Space'); await details(page).waitFor();
  check('Space opens ' + width + '/' + preference);
  await page.keyboard.press('Tab');
  check('logical keyboard entry into open folder ' + width + '/' + preference, await page.evaluate(() => document.activeElement.matches('.bf-preview a, .bf-details button')));
  await toggle(page, 'course').click(); await details(page).getByRole('heading', { name: 'Saved Course', exact: true }).waitFor();
  check('switch folder / one open ' + width + '/' + preference, await page.locator('.bf-folder[data-open="true"]').count() === 1);
  await toggle(page, 'course').click(); check('same folder closes ' + width + '/' + preference, await details(page).count() === 0);
  await toggle(page, 'module').click();
  check('module metadata ' + width + '/' + preference, (await details(page).innerText()).includes('Module 01 · TEST ONLY Course') && (await details(page).innerText()).includes('TEST ONLY 测试单元'));
  await page.locator('h1').click(); check('outside closes ' + width + '/' + preference, await details(page).count() === 0);
  check('browsing sends no writes ' + width + '/' + preference, requests.every(r => r.method === 'GET'));
  check('no Add / enrollment wording ' + width + '/' + preference, !/\b(enroll|enrolled|enrollment|add bookmark|untitled)\b/i.test(await page.locator('main').innerText()));
  await context.close();
}
async function drawerCases() {
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const options = { rows: [records().find(r => r.targetType === 'module')] };
    await fixtures(context, options); const page = await context.newPage(); monitor(page);
    await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'module').click();
    const single = await details(page).boundingBox();
    check('one document auto height ' + width, await details(page).locator('.bf-document').count() === 1 && single.height < 350);
    await details(page).getByRole('link', { name: 'Open TEST ONLY Module', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.waitForURL(base + '/course/test-only-course/modules/test-only-module-301'); check('document Enter navigation ' + width);
    await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'course').click();
    check('zero-item compact drawer ' + width, (await details(page).boundingBox()).height < 130);
    options.rows = records().filter(r => r.targetType === 'paper' && r.available).slice(0, 4);
    await page.reload(); await ready(page); await toggle(page, 'paper').click();
    check('four documents use natural height ' + width, await details(page).locator('.bf-documents').evaluate(el => getComputedStyle(el).maxHeight === 'none' && el.scrollHeight <= el.clientHeight + 1));
    options.rows = Array.from({ length: 50 }, (_, i) => {
      const row = structuredClone(records()[0]); row.id = 1001 + i; row.target.id = row.id;
      row.target.slug = 'test-only-many-' + row.id; row.target.title = 'TEST ONLY long document title ' + row.id + ' ' + 'LongWord'.repeat(i === 49 ? 15 : 0); return row;
    });
    await page.reload(); await ready(page); await toggle(page, 'paper').click();
    const list = details(page).locator('.bf-documents');
    check('all 50 accessible within bounded scroll ' + width, await list.locator('.bf-document').count() === 50 && await list.evaluate(el => el.scrollHeight > el.clientHeight && el.clientHeight <= 520));
    await list.focus(); await page.keyboard.press('End'); await page.waitForTimeout(100);
    check('keyboard scroll reaches last documents ' + width, await list.evaluate(el => el.scrollTop > 0));
    await list.scrollIntoViewIfNeeded(); await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const box = await list.boundingBox(); await page.mouse.move(box.x + box.width / 2, Math.max(10, Math.min(990, box.y + box.height / 2)));
    const before = await page.evaluate(() => scrollY); await page.mouse.wheel(0, 500); await page.waitForTimeout(180);
    check('scroll boundary releases to page ' + width, await page.evaluate(() => scrollY) > before);
    await layout(page, '50 documents ' + width);
    const last = list.getByRole('link').last();
    await last.click(); await page.waitForURL(base + '/papers/test-only-many-1050'); check('last of 50 opens original target ' + width);
    await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'paper').click();
    await page.locator('[data-remove-id="1001"]').focus(); await page.keyboard.press('Space'); await ready(page);
    check('Remove keyboard action does not navigate ' + width, new URL(page.url()).pathname === '/bookmarks' && options.rows.length === 49);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixtures(context); const page = await context.newPage(); monitor(page);
  await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'paper').click(); await page.waitForTimeout(240);
  const closeState = await page.evaluate(() => {
    const el = document.querySelector('.bf-details[data-type="paper"]'); document.querySelector('[data-folder-toggle="paper"]').click();
    return new Promise(resolve => requestAnimationFrame(() => resolve({ inert: el.inert, hidden: el.hidden, duration: el.getAnimations().at(-1)?.effect.getTiming().duration })));
  });
  check('closing fade is inert and short', closeState.inert && !closeState.hidden && closeState.duration === 130);
  await page.waitForTimeout(200); check('closing fade fully removes layout', await page.locator('.bf-details:not([hidden])').count() === 0);
  for (let round = 0; round < 6; round++) for (const kind of ['paper', 'module', 'course', 'research_area']) await toggle(page, kind).evaluate(el => el.click());
  await page.waitForTimeout(280);
  check('rapid switching leaves only matching drawer', await page.locator('.bf-details:not([hidden])').count() === 1 && await details(page).getAttribute('data-type') === 'research_area');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('rapid switching / close restores current folder focus', await toggle(page, 'research_area').evaluate(el => document.activeElement === el));
  await toggle(page, 'paper').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.bf-details:not([hidden])'));
  check('reduced motion close has no lingering animation');
  await context.close();
}
async function previewAndMotion() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await fixtures(context); const page = await context.newPage(); monitor(page);
  await page.goto(base + '/bookmarks'); await ready(page);
  await toggle(page, 'paper').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  const first = page.locator('.bf-folder[data-type="paper"] .bf-preview a').first();
  check('preview link is keyboard accessible', await first.evaluate(el => document.activeElement === el));
  await page.keyboard.press('Enter'); await page.waitForURL(base + '/papers/test-only-paper-101'); check('preview Enter navigates original source');
  await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'paper').click(); await page.waitForTimeout(600);
  const last = page.locator('.bf-folder[data-type="paper"] .bf-preview a').last();
  const point = await last.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (let y = Math.max(0, r.top + 10); y < Math.min(innerHeight, r.bottom); y += 8) for (let x = Math.max(0, r.left + 10); x < Math.min(innerWidth, r.right); x += 8) if (el.contains(document.elementFromPoint(x, y))) return { x, y };
    return null;
  });
  check('fan sheet has a real pointer target', !!point);
  await page.mouse.move(point.x, point.y); await page.waitForTimeout(450);
  await last.click({ position: { x: 100, y: 25 } }); await page.waitForURL(base + '/papers/test-only-paper-103'); check('preview click navigates original source');
  await page.goto(base + '/bookmarks'); await ready(page);
  const folder = page.locator('.bf-folder[data-type="paper"] .bf-object');
  const r = await folder.boundingBox(); await page.mouse.move(r.x + r.width * .75, r.y + r.height * .8); await page.waitForTimeout(500);
  check('event-driven pointer parallax', await folder.evaluate(el => Math.abs(Number(el.style.getPropertyValue('--bf-px'))) > .1));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.mouse.move(r.x + 30, r.y + 30); await page.waitForTimeout(50);
  check('live reduced motion disables parallax', await folder.evaluate(el => !el.style.getPropertyValue('--bf-px') && getComputedStyle(el.querySelector('.bf-tilt')).transform === 'none'));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.mouse.move(1, 1); await page.waitForTimeout(700);
  const count = await folder.evaluate(el => new Promise(resolve => {
    let count = 0; const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(el, { subtree: true, attributes: true, childList: true });
    setTimeout(() => { observer.disconnect(); resolve(count); }, 400);
  }));
  check('no idle folder frame mutations', count === 0);
  await context.close();
}
async function mutationsAndStates() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const options = { failLoad: true }, requests = await fixtures(context, options), page = await context.newPage(); monitor(page);
  await page.goto(base + '/bookmarks'); await page.getByRole('alert').filter({ hasText: 'Bookmarks are unavailable' }).waitFor();
  options.failLoad = false; await page.getByRole('button', { name: 'Refresh bookmarks' }).click(); await ready(page); check('load error + retry');
  await toggle(page, 'paper').click();
  options.failRemove = true; await page.locator('[data-remove-id="101"]').click(); await page.getByRole('alert').filter({ hasText: 'TEST ONLY remove failure' }).waitFor();
  check('failed removal preserves row and count', await details(page).locator('.bf-document').count() === 8 && (await toggle(page, 'paper').innerText()).includes('8 items'));
  options.failRemove = false; await page.getByRole('button', { name: 'Refresh bookmarks' }).click(); await ready(page);
  check('refresh restores removal focus', await page.locator('[data-remove-id="101"]').evaluate(el => document.activeElement === el));
  await page.locator('[data-remove-id="101"]').click(); await ready(page);
  check('delete refreshes actual count', (await toggle(page, 'paper').innerText()).includes('7 items') && await details(page).locator('.bf-document').count() === 7);
  check('remove focus next item', await page.locator('[data-remove-id="102"]').evaluate(el => document.activeElement === el));
  check('removal feedback', (await page.locator('.bw-feedback').innerText()).includes('Bookmark removed.'));
  await page.locator('[data-remove-id="108"]').click(); await ready(page);
  check('unavailable bookmark removable', await details(page).getByRole('heading', { name: 'Unavailable paper' }).count() === 0);
  await toggle(page, 'course').click(); await page.locator('[data-remove-id="201"]').click(); await ready(page);
  check('last item / zero folder / focus restore', (await toggle(page, 'course').innerText()).includes('0 items') && (await details(page).innerText()).includes('No saved items in this folder.') && await toggle(page, 'course').evaluate(el => document.activeElement === el));
  for (const kind of kinds) {
    if (await toggle(page, kind).getAttribute('aria-expanded') !== 'true') await toggle(page, kind).click();
    if (!options.rows.some(r => r.targetType === kind && r.available)) continue;
    const expected = options.rows.find(r => r.targetType === kind && r.available).target;
    const href = kind === 'paper' ? '/papers/' + expected.slug : kind === 'course' ? '/course/' + expected.slug : kind === 'module' ? '/course/' + expected.courseSlug + '/modules/' + expected.slug : '/research/' + expected.slug;
    const link = details(page).getByRole('link', { name: 'Open ' + expected.title, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    await link.click(); await page.waitForURL(base + href); check('original navigation ' + kind);
    await page.goto(base + '/bookmarks'); await ready(page);
  }
  // Course was removed above: restore a TEST ONLY row in the isolated mock, not production.
  options.rows.push(records().find(r => r.targetType === 'course'));
  await page.reload(); await ready(page); await toggle(page, 'course').click();
  await details(page).getByRole('link', { name: 'Open TEST ONLY Course', exact: true }).click();
  await page.waitForURL(base + '/course/test-only-course-201'); check('original navigation course');
  await page.goto(base + '/bookmarks'); await ready(page); await toggle(page, 'paper').click();
  const preview = page.locator('.bf-folder[data-type="paper"] .bf-preview a').first();
  check('preview uses original bookmark path', (await preview.getAttribute('href')).startsWith('/papers/test-only-paper-'));
  // Account identity changes through the existing auth refresh, while an old response is delayed.
  options.delay = 450; await page.reload();
  await page.waitForRequest(r => new URL(r.url()).pathname === '/api/learning/bookmarks');
  options.account = 902; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await ready(page); await page.waitForTimeout(600);
  check('account switch ignores delayed private response', (await page.locator('main').innerText()).includes('No bookmarks yet.') && !(await page.locator('main').innerText()).includes('TEST ONLY Paper'));
  check('only bookmark DELETE mutations', requests.filter(r => r.method !== 'GET').every(r => r.method === 'DELETE' && /^\/api\/learning\/bookmarks\/\d+$/.test(r.url)));
  await context.close();
  const emptyContext = await browser.newContext({ reducedMotion: 'reduce' });
  await fixtures(emptyContext, { rows: [] }); const empty = await emptyContext.newPage(); monitor(empty);
  await empty.goto(base + '/bookmarks'); await ready(empty);
  check('honest global empty + four folders', await empty.getByRole('heading', { name: 'No bookmarks yet.' }).count() === 1 && await empty.locator('.bf-folder').count() === 4);
  check('browse empty links', await empty.getByRole('link', { name: 'Browse course →' }).count() === 1 && await empty.getByRole('link', { name: 'Browse papers →' }).getAttribute('href') === '/papers');
  await toggle(empty, 'research_area').click(); check('zero-item folder opens', (await details(empty).innerText()).includes('No saved items in this folder.'));
  await emptyContext.close();
  const anonymous = await browser.newContext(); const anonRequests = await fixtures(anonymous, { anonymous: true }); const anonPage = await anonymous.newPage(); monitor(anonPage);
  await anonPage.goto(base + '/bookmarks'); await anonPage.waitForURL(base + '/login');
  check('anonymous redirect / no private read', !anonRequests.some(r => r.url === '/api/learning/bookmarks'));
  await anonymous.close();
}
(async () => {
  await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true, channel: 'msedge' });
  for (const width of [1440, 820, 390]) for (const preference of ['no-preference', 'reduce']) await viewport(width, preference);
  await mutationsAndStates(); await previewAndMotion(); await drawerCases();
  check('no unhandled errors', errors.length === 0);
  check('no automatic learning writes', writes.every(r => r.method === 'DELETE' && /^\/api\/learning\/bookmarks\/\d+$/.test(r.url)));
  console.log(JSON.stringify({ checks: checks.length, errors, writes }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors, writes }, null, 2)); await browser?.close();
});

