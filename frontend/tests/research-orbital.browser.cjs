/* TEST ONLY API mocks. No production database or uploads are contacted.
 * Run with Playwright installed (or available through NODE_PATH) against Vite.
 * UI_P1_ORIGIN must point to an isolated 127.0.0.1 frontend.
 * Screenshots/results default to the ignored tmp/ui-p1 directory.
 */
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.UI_P1_ORIGIN || 'http://127.0.0.1:5176';
const output = process.env.UI_P1_OUTPUT || 'tmp/ui-p1';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const checks = [], errors = [], unexpectedWrites = [];
let browser;
function check(label, value = true) { assert.ok(value, label); checks.push(label); }
async function fixtures(context, options = {}) {
  const canonical = JSON.parse(await fs.readFile('project/migrations/data/research_areas.json', 'utf8'));
  const areas = canonical.areas.map((area, index) => ({ ...area, id: index + 1, overview: '', subtopics: [], brainRegionSlugs: [] }));
  if (options.overview) areas[1].overview = 'TEST ONLY API-provided overview. '.repeat(100);
  let bookmarks = [];
  await context.route(base + '/api/**', route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (!['GET', 'HEAD'].includes(method) && !url.pathname.startsWith('/api/learning/bookmarks')) unexpectedWrites.push({ url: request.url(), method });
    let status = 200, body;
    if (url.pathname === '/api/auth/me') body = options.authenticated ? { authenticated: true, user: { id: 901, role: 'student', username: 'TEST ONLY', email: 'test@example.test', isActive: true } } : { authenticated: false, user: null };
    else if (url.pathname === '/api/auth/csrf') body = { csrfToken: 'TEST-ONLY-csrf-token' };
    else if (url.pathname === '/api/learning/bookmarks') {
      if (method === 'POST') {
        const { targetType, targetId } = request.postDataJSON(), area = areas.find(area => area.id === targetId);
        const bookmark = { id: 7001, targetType, createdAt: '2026-10-13T00:00:00Z', available: true, target: { ...area, title: area.name } };
        bookmarks = [bookmark]; body = { bookmark };
      } else body = { bookmarks };
    } else if (url.pathname === '/api/learning/bookmarks/7001' && method === 'DELETE') { bookmarks = []; body = { deleted: true }; }
    else if (url.pathname === '/api/research-areas') {
      if (options.fail) { status = 503; body = { error: 'TEST ONLY failure' }; }
      else body = { areas: options.empty ? [] : areas };
    } else if (url.pathname.startsWith('/api/research-areas/')) {
      const area = areas.find(area => area.slug === decodeURIComponent(url.pathname.split('/').at(-1)));
      if (!area) { status = 404; body = { error: 'TEST ONLY not found' }; }
      else body = { area, papers: [{ relationId: 1, sortOrder: 1, paper: { id: 1, slug: 'test-only-paper', title: 'TEST ONLY Paper', authors: [] } }],
        modules: [{ relationId: 1, sortOrder: 1, course: { id: 1, slug: 'test-only-course', title: '' }, module: { id: 1, slug: 'test-only-module', title: 'TEST ONLY Module', titleZh: 'TEST ONLY', number: 1, durationHours: 3 } }],
        resources: [{ id: 1, displayName: 'TEST ONLY Resource', description: null, attachmentType: 'pdf', accessLevel: 'public', version: 1, sortOrder: 1, externalUrl: null, downloadUrl: '/api/test-only-download' }], brainRegions: [{ slug: 'test-only-region', name: 'TEST ONLY Region' }], hubContent: [] };
    } else { status = 404; body = { error: 'TEST ONLY unavailable' }; }
    return route.fulfill({ status, json: body });
  });
  return areas;
}
function monitor(page) { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); }
async function ready(page) { await page.waitForFunction(() => !document.querySelector('.auth-loading-button') && document.querySelector('main')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('.research-orbital-node').length === 6); }
async function spinState(page) { return page.locator('.research-orbital-rotor').evaluate(element => { const animation = element.getAnimations().find(animation => animation.effect.getTiming().iterations === Infinity); return { time: animation.currentTime, state: animation.playState }; }); }
async function layout(page, width) {
  const result = await page.evaluate(() => {
    const card = document.querySelector('.research-orbital-detail'), nav = document.querySelector('.navbar').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      nodes: [...document.querySelectorAll('.research-orbital-node')].every(element => { const box = element.getBoundingClientRect(); return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth; }),
      card: !card || (() => { const box = card.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= nav.bottom; })(),
      nested: [...document.querySelectorAll('.research-orbital *')].some(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight),
    };
  });
  check('responsive/touch/no scroll trap ' + width, !result.overflow && result.nodes && result.card && !result.nested);
}
async function viewport(width, motionMode) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: motionMode });
  const areas = await fixtures(context), page = await context.newPage(); monitor(page);
  await page.goto(base + '/research'); await ready(page); await page.mouse.move(1, 1);
  const nodes = page.locator('.research-orbital-node'); check(`all API identities ${width}/${motionMode}`, await nodes.count() === 6);
  for (let index = 0; index < areas.length; index++) assert.equal((await nodes.nth(index).innerText()).replace(/\s+/g, ' ').trim(), areas[index].code + ' ' + areas[index].name);
  await nodes.nth(0).focus();
  for (let index = 1; index < areas.length; index++) { await page.keyboard.press('Tab'); assert.ok(await nodes.nth(index).evaluate(element => document.activeElement === element)); }
  check(`Tab reaches all six nodes ${width}/${motionMode}`, await nodes.nth(5).evaluate(element => getComputedStyle(element).outlineStyle !== 'none'));
  await page.locator('.research-orbital').focus();
  const before = await spinState(page); await page.waitForTimeout(250); const after = await spinState(page);
  check(`automatic/reduced motion ${width}/${motionMode}`, motionMode === 'reduce' ? after.state === 'paused' && after.time === before.time : after.state === 'running' && after.time > before.time);
  await nodes.nth(1).focus(); const focusTime = await spinState(page); await page.waitForTimeout(100);
  check(`focus pauses ${width}/${motionMode}`, (await spinState(page)).time === focusTime.time);
  await page.keyboard.press('Enter'); await page.locator('.research-orbital-detail').waitFor(); await page.waitForTimeout(720);
  check(`selection pauses ${width}/${motionMode}`, (await spinState(page)).state === 'paused');
  const aligned = await nodes.nth(1).evaluate(element => { const stage = document.querySelector('.research-orbital-stage').getBoundingClientRect(), box = element.getBoundingClientRect(), radius = parseFloat(getComputedStyle(document.querySelector('.research-orbital')).getPropertyValue('--orbit-radius')); return Math.abs((box.left + box.right) / 2 - (stage.left + stage.right) / 2) < 2 && Math.abs((box.top + box.bottom) / 2 - ((stage.top + stage.bottom) / 2 - radius)) < 2; });
  check(`selected node aligns to top ${width}/${motionMode}`, aligned);
  check(`blank overview stays absent ${width}/${motionMode}`, await page.locator('.research-orbital-overview').count() === 0);
  check(`other nodes remain pointer-accessible ${width}/${motionMode}`, await page.locator('.research-orbital-code').evaluateAll(elements => elements.every(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2); return hit && element.closest('button').contains(hit); })));
  await layout(page, width); await page.screenshot({ path: path.join(output, `expanded-${width}-${motionMode}.png`), fullPage: true });
  await nodes.nth(4).focus(); await page.keyboard.press('Space'); await page.waitForTimeout(720);
  check(`switch selected area ${width}/${motionMode}`, await page.locator('.research-orbital-detail h2').innerText() === areas[4].name);
  assert.equal(await page.locator('.research-orbital-detail a').getAttribute('href'), '/research/' + areas[4].slug);
  await page.keyboard.press('Escape'); await page.locator('.research-orbital-detail').waitFor({ state: 'detached' }); check(`Escape/focus restore ${width}/${motionMode}`, await nodes.nth(4).evaluate(element => document.activeElement === element));
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.locator('.research-orbital-detail').waitFor({ state: 'detached' }); check(`same node toggles ${width}/${motionMode}`, await page.locator('.research-orbital-detail').count() === 0);
  await nodes.nth(0).focus(); await page.keyboard.press('Enter');
  await page.locator('.research-orbital-stage').click({ position: { x: 5, y: 5 }, force: true });
  await page.locator('.research-orbital-detail').waitFor({ state: 'detached' });
  check(`blank dismiss/restart ${width}/${motionMode}`, await page.locator('.research-orbital-detail').count() === 0 && (await spinState(page)).state === (motionMode === 'reduce' ? 'paused' : 'running'));
  await nodes.nth(0).hover({ force: true }); check(`hover pauses ${width}/${motionMode}`, (await spinState(page)).state === 'paused');
  await page.mouse.move(1, 1);
  await nodes.nth(3).focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Close research area details' }).click();
  await page.locator('.research-orbital-detail').waitFor({ state: 'detached' });
  await page.locator('.research-orbital').focus(); await page.mouse.move(1, 1);
  check(`close does not retain hover pause ${width}/${motionMode}`, (await spinState(page)).state === (motionMode === 'reduce' ? 'paused' : 'running'));
  if (motionMode === 'no-preference') {
    const mutations = await page.locator('.research-orbital').evaluate(element => new Promise(resolve => { let count = 0; const observer = new MutationObserver(records => { count += records.length; }); observer.observe(element, { subtree: true, attributes: true, childList: true, characterData: true }); setTimeout(() => { observer.disconnect(); resolve(count); }, 600); }));
    check('no per-frame DOM/state mutations ' + width, mutations === 0);
    await page.setViewportSize({ width, height: 240 });
    const footer = page.locator('footer'); await footer.scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
    check('offscreen rotation paused ' + width, (await spinState(page)).state === 'paused');
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.locator('.research-orbital').scrollIntoViewIfNeeded(); await page.waitForTimeout(100); check('onscreen rotation resumes ' + width, (await spinState(page)).state === 'running');
  }
  await nodes.nth(2).focus(); await page.keyboard.press('Enter');
  await page.evaluate(() => { window.__uiP1Animations = document.querySelector('.research-orbital').getAnimations({ subtree: true }); });
  await page.getByRole('link', { name: 'Explore Area', exact: true }).click(); await page.waitForURL(base + '/research/' + areas[2].slug);
  await page.locator('main').getByRole('heading', { name: areas[2].name, exact: true }).waitFor();
  check(`Explore routes to original detail ${width}/${motionMode}`, await page.locator('.research-orbital').count() === 0);
  check(`unmount cancels native animations ${width}/${motionMode}`, await page.evaluate(() => window.__uiP1Animations.every(animation => animation.playState === 'idle' || animation.playState === 'finished' && animation.effect.getTiming().iterations !== Infinity)));
  await page.getByRole('link', { name: 'Back to Research Areas' }).click(); await page.waitForURL(base + '/research'); await ready(page);
  await page.screenshot({ path: path.join(output, `idle-${width}-${motionMode}.png`), fullPage: true });
  await context.close();
}
async function statesAndRegression() {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  const options = { fail: true, overview: true, authenticated: true };
  const areas = await fixtures(context, options), page = await context.newPage(); monitor(page);
  await page.goto(base + '/research'); await page.getByRole('heading', { name: 'Research unavailable' }).waitFor();
  options.fail = false;
  await page.getByRole('button', { name: 'Refresh research' }).click(); await ready(page); check('original error/Retry preserved');
  await page.locator('.research-orbital-node').nth(1).focus(); await page.keyboard.press('Enter');
  check('overview uses API text only', (await page.locator('.research-orbital-overview').innerText()).startsWith('TEST ONLY API-provided overview.'));
  await layout(page, 1440);
  // Rapid selection must interrupt alignment cleanly, including close mid-flight.
  for (let round = 0; round < 5; round++) {
    for (const index of [0, 5, 2, 4]) await page.locator('.research-orbital-node').nth(index).evaluate(element => element.click());
  }
  await page.waitForTimeout(750); check('rapid selection final state', await page.locator('.research-orbital-detail h2').innerText() === areas[4].name);
  await page.locator('.research-orbital-node').nth(0).evaluate(element => element.click());
  await page.keyboard.press('Escape'); await page.locator('.research-orbital-detail').waitFor({ state: 'detached' }); check('close interrupts finite animation', await page.locator('.research-orbital-detail').count() === 0);
  for (const area of areas) {
    await page.goto(base + '/research/' + area.slug); await page.locator('main').getByRole('heading', { name: area.name, exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /TEST ONLY Paper/ }).getAttribute('href'), '/papers/test-only-paper');
    assert.equal(await page.getByRole('link', { name: /TEST ONLY Module/ }).getAttribute('href'), '/course/test-only-course/modules/test-only-module');
    assert.equal(await page.getByRole('link', { name: 'Download resource' }).getAttribute('href'), '/api/test-only-download');
    check('independent detail/relationships preserved ' + area.slug);
  }
  await page.getByRole('button', { name: 'Save research area', exact: true }).click();
  await page.getByRole('button', { name: 'Remove research area from bookmarks', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Remove research area from bookmarks', exact: true }).click();
  await page.getByRole('button', { name: 'Save research area', exact: true }).waitFor(); check('original bookmark save/reload/remove preserved');
  await page.goto(base + '/research/test-only-missing'); await page.getByRole('heading', { name: 'Research area not found' }).waitFor(); check('detail 404 preserved');
  await context.close();
  const empty = await browser.newContext(); await fixtures(empty, { empty: true }); const ep = await empty.newPage(); monitor(ep);
  await ep.goto(base + '/research'); await ep.getByText('No research areas are currently available.').waitFor(); check('original empty state preserved'); await empty.close();
}
async function panelCases(preference) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: preference });
  const areas = await fixtures(context), page = await context.newPage(); monitor(page);
  await page.goto(base + '/research'); await ready(page);
  await page.locator('.research-orbital-node').nth(0).evaluate(element => element.click());
  await page.locator('.research-orbital-detail').waitFor();
  const entry = await page.locator('.research-orbital-detail').evaluate(element => element.getAnimations().map(animation => ({ duration: animation.effect.getTiming().duration, state: animation.playState })));
  check('panel entry respects motion ' + preference, preference === 'reduce' ? entry.length === 0 : entry.some(animation => animation.duration === 180));
  await page.waitForTimeout(220);
  await page.evaluate(() => { window.__uiP1Panel = document.querySelector('.research-orbital-detail'); });
  await page.locator('.research-orbital-node').nth(4).evaluate(element => element.click());
  check('panel stable during node switch ' + preference, await page.locator('.research-orbital-detail').evaluate(element => element === window.__uiP1Panel));
  check('switched content remains authoritative ' + preference, await page.locator('.research-orbital-detail h2').innerText() === areas[4].name);
  await page.getByRole('button', { name: 'Close research area details' }).focus();
  check('panel close visible focus ' + preference, await page.getByRole('button', { name: 'Close research area details' }).evaluate(element => getComputedStyle(element).outlineStyle !== 'none'));
  await page.keyboard.press('Enter');
  if (preference !== 'reduce') {
    check('closing panel inert and hidden to assistive tech', await page.locator('.research-orbital-detail').evaluate(element => element.inert && element.getAttribute('aria-hidden') === 'true' && element.getAnimations().some(animation => animation.effect.getTiming().duration === 140)));
    // Reopen during fade: a stale finish callback must not remove the new panel.
    await page.locator('.research-orbital-node').nth(1).evaluate(element => element.click());
    await page.waitForTimeout(240);
    check('reopen interrupts close without stale removal', await page.locator('.research-orbital-detail h2').innerText() === areas[1].name);
    await page.keyboard.press('Escape');
  }
  await page.locator('.research-orbital-detail').waitFor({ state: 'detached' });
  check('panel exit completes ' + preference);
  const core = page.locator('.research-orbital-core-light');
  const values = await core.evaluate(element => {
    const animation = element.getAnimations().find(animation => animation.animationName === 'research-core-breathe');
    if (!animation) return { static: getComputedStyle(element).animationName === 'none' };
    animation.pause(); animation.currentTime = 0; const dim = Number(getComputedStyle(element).opacity);
    animation.currentTime = 2000; const bright = Number(getComputedStyle(element).opacity);
    animation.play(); return { dim, bright, duration: animation.effect.getTiming().duration };
  });
  check('core light/dark breathing ' + preference, preference === 'reduce' ? values.static : values.dim <= .46 && values.bright >= .99 && values.duration === 4000);
  await context.close();
}
async function resumeCases(width, preference) {
  const touch = width !== 1440;
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: touch, reducedMotion: preference });
  await fixtures(context); const page = await context.newPage(); monitor(page);
  await page.goto(base + '/research'); await ready(page);
  const node = page.locator('.research-orbital-node').first();
  if (touch) await node.tap({ force: true }); else { await node.hover({ force: true }); await node.click(); }
  await page.locator('.research-orbital-detail').waitFor(); await page.waitForTimeout(720);
  check(`open panel still pauses ${width}/${preference}`, (await spinState(page)).state === 'paused');
  if (!touch) { await page.mouse.move(1, 1); check('mouse leave cannot resume while panel open', (await spinState(page)).state === 'paused'); }
  const close = page.getByRole('button', { name: 'Close research area details' });
  if (touch) await close.tap(); else await close.click();
  await page.locator('.research-orbital-detail').waitFor({ state: 'detached' });
  if (!touch) await page.mouse.move(1, 1);
  const before = await spinState(page); await page.waitForTimeout(120); const after = await spinState(page);
  check(`pointer/touch close resumes without outside click ${width}/${preference}`, preference === 'reduce' ? after.state === 'paused' && after.time === before.time : after.state === 'running' && after.time > before.time);
  check(`restored focus preserved without pointer pause ${width}/${preference}`, await node.evaluate(element => document.activeElement === element && !element.matches(':focus-visible')));
  if (touch) {
    // Closing a below-orbit mobile panel may leave the top node under the
    // existing sticky Navbar. Scroll it into view without changing focus.
    await page.evaluate(() => window.scrollTo(0, 0));
    await node.tap({ force: true }); await page.locator('.research-orbital-detail').waitFor(); await page.waitForTimeout(720);
    await node.tap({ force: true }); await page.locator('.research-orbital-detail').waitFor({ state: 'detached' });
    check(`repeat touch toggles and resumes ${width}/${preference}`, (await spinState(page)).state === (preference === 'reduce' ? 'paused' : 'running'));
  } else {
    await node.hover({ force: true }); check('genuine mouse hover remains paused', (await spinState(page)).state === 'paused');
    await page.mouse.move(1, 1); check('mouse departure resumes despite restored focus', (await spinState(page)).state === (preference === 'reduce' ? 'paused' : 'running'));
  }
  await page.locator('.research-orbital').focus(); await page.keyboard.press('Tab');
  check(`keyboard focus pause preserved ${width}/${preference}`, (await spinState(page)).state === 'paused');
  await context.close();
}
(async () => {
  await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true, channel: 'msedge' });
  for (const width of [1440, 820, 390]) for (const preference of ['no-preference', 'reduce']) await viewport(width, preference);
  await statesAndRegression(); for (const preference of ['no-preference', 'reduce']) await panelCases(preference);
  for (const width of [390, 820, 1440]) for (const preference of ['no-preference', 'reduce']) await resumeCases(width, preference);
  check('no unhandled errors', errors.length === 0); check('no automatic learning writes', unexpectedWrites.length === 0);
  console.log(JSON.stringify({ checks: checks.length, errors, unexpectedWrites }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors, unexpectedWrites }, null, 2)); await browser?.close();
});
