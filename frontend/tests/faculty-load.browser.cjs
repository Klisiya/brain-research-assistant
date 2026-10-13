/* TEST ONLY. Run against an isolated R8A1 fixture server; never production.
 * Requires Playwright (NODE_PATH may point to the desktop's bundled runtime).
 * HUB_TEST_ORIGIN selects the isolated Vite server, HUB_TEST_BACKEND optionally
 * forwards Hub reads to its normal-mode fixture backend (rate limits enabled).
 * HUB_TEST_RESET_LIMITS=1 requires the fixture-only reset endpoint.
 * HUB_TEST_OUTPUT selects an ignored folder for evidence and screenshots.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.HUB_TEST_ORIGIN || 'http://127.0.0.1:5174';
const backend = process.env.HUB_TEST_BACKEND;
const output = process.env.HUB_TEST_OUTPUT || 'tmp/r8a1-bugfix/browser';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
if (backend) assert.match(backend, /^http:\/\/127\.0\.0\.1:\d+$/);
const checks = [], requests = [], pageErrors = [], learningWrites = [];
let requestId = 0, browser;
function check(label, value = true) { assert.ok(value, label); checks.push(label); }
async function login(context, account = 'admin') {
  const csrf = (await (await context.request.get(base + '/api/auth/csrf')).json()).csrfToken;
  const response = await context.request.post(base + '/api/auth/login', {
    headers: { 'X-CSRF-Token': csrf },
    data: { email: account + '@example.test', password: 'TEST-ONLY-R8A1-password', remember: false },
  });
  assert.equal(response.status(), 200);
  if (process.env.HUB_TEST_RESET_LIMITS === '1') {
    const currentToken = (await (await context.request.get(base + '/api/auth/csrf')).json()).csrfToken;
    const reset = await context.request.post((backend || base) + '/__test/reset-hub-limits', { headers: { 'X-CSRF-Token': currentToken } });
    assert.equal(reset.status(), 200);
  }
}
function monitor(page) {
  page.setDefaultTimeout(10000);
  const rows = new Map();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('request', r => {
    if (/\/api\/hub\//.test(r.url())) {
      const row = { id: ++requestId, url: r.url(), method: r.method(), started: Date.now() };
      rows.set(r, row); requests.push(row);
    }
    if (/\/api\/(learning|reading|progress)\//.test(r.url()) && !['GET', 'HEAD'].includes(r.method())) learningWrites.push(r.url());
  });
  page.on('requestfailed', r => { if (rows.has(r)) Object.assign(rows.get(r), { ended: Date.now(), failure: r.failure() }); });
  page.on('response', async r => {
    if (rows.has(r.request())) {
      const row = rows.get(r.request());
      Object.assign(row, { status: r.status(), ended: Date.now() });
      try { row.response = await r.text(); } catch { row.cancelledBody = true; }
    }
  });
}
async function forward(page) {
  if (backend) await page.route('**/api/hub/**', async route => {
    try { await route.fulfill({ response: await route.fetch({ url: route.request().url().replace(base, backend) }) }); }
    catch { await route.abort(); }
  });
}
async function rapidFlows(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce' });
  await login(context);
  const page = await context.newPage(); monitor(page); await forward(page);
  await page.goto(base + '/innovation-hub?view=faculty');
  const facultyTab = page.getByRole('navigation', { name: 'Innovation Hub views' }).getByRole('link', { name: 'Faculty Resources', exact: true });
  await facultyTab.click({ clickCount: 6 });
  await page.getByText('TEST ONLY Published Faculty Resource', { exact: true }).waitFor();
  check('repeated Faculty tab ' + width);
  await page.getByRole('link', { name: 'Manage Faculty Resources →', exact: true }).click();
  for (let round = 0; round < 6; round++) {
    for (const name of ['My resources', 'All resources / Review', 'Create resource', '← Faculty Resources', 'Published resources', 'Manage Faculty Resources →']) {
      await page.locator('main').getByRole('link', { name, exact: true }).click();
    }
    const navigation = page.getByRole('navigation', { name: 'Management navigation' });
    for (const name of ['Management', 'Papers', 'Faculty Resources']) await navigation.getByRole('link', { name, exact: true }).click();
    await page.getByRole('link', { name: 'My resources', exact: true }).waitFor();
    check(`rapid Management/Papers/Faculty/Create/Back/views ${width} round ${round + 1}`, await page.getByRole('heading', { name: 'Faculty Resources unavailable', exact: true }).count() === 0);
  }
  await page.reload(); await page.getByRole('link', { name: 'My resources', exact: true }).waitFor(); check('refresh ' + width);
  check('no overflow ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, `faculty-${width}.png`), fullPage: true });
  await context.close();
}
async function raceCases() {
  const context = await browser.newContext({ reducedMotion: 'reduce' }); await login(context);
  // This deliberately uncooperative transport ignores cancellation. It tests
  // that stale callbacks cannot overwrite newer data, errors, or loading state.
  await context.addInitScript(() => {
    const original = window.fetch;
    window.__facultyLoads = [];
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes('/api/hub/entries?')) return original(input, init);
      return new Promise((resolve, reject) => {
        window.__facultyLoads.push({ url, signal: input instanceof Request ? input.signal : init?.signal,
          finish(status, body) { resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })); },
          fail() { reject(new TypeError('TEST ONLY network failure')); },
          cancel() { reject(new DOMException('TEST ONLY cancelled', 'AbortError')); },
        });
      });
    };
  });
  const page = await context.newPage(); monitor(page);
  await page.goto(base + '/manage/hub');
  const waitLoad = scope => page.waitForFunction(scope => window.__facultyLoads.some(x => x.url.includes('scope=' + scope) && !x.signal.aborted), scope);
  const count = () => page.evaluate(() => window.__facultyLoads.length);
  const waitNext = (scope, previous) => page.waitForFunction(({ scope, previous }) => window.__facultyLoads.length > previous && window.__facultyLoads.at(-1).url.includes('scope=' + scope) && !window.__facultyLoads.at(-1).signal.aborted, { scope, previous });
  const settle = (index, status, marker) => page.evaluate(({ index, status, marker }) => {
    const body = status === 200 ? { entries: [{ id: 9001, kind: 'faculty', status: 'draft', working: { title: marker, state: 'draft' }, published: null }], page: 1, totalPages: 1, total: 1 } : { error: marker };
    window.__facultyLoads[index].finish(status, body);
  }, { index, status, marker });
  await waitLoad('mine');
  const initial = await count(); check('StrictMode repeated effect exercised', initial >= 2);
  await settle(initial - 1, 200, 'TEST ONLY initial success');
  await page.getByRole('heading', { name: 'TEST ONLY initial success' }).waitFor();
  for (let index = 0; index < initial - 1; index++) await page.evaluate(index => window.__facultyLoads[index].cancel(), index);
  check('intentional cancellation ignored', await page.getByRole('heading', { name: 'Faculty Resources unavailable' }).count() === 0);
  // A starts, B starts, B succeeds, A fails late.
  let previous = await count();
  await page.getByRole('link', { name: 'All resources / Review', exact: true }).click(); await waitNext('review', previous);
  const oldA = (await count()) - 1;
  previous = await count();
  await page.getByRole('navigation', { name: 'Management navigation' }).getByRole('link', { name: 'Faculty Resources', exact: true }).click(); await waitNext('mine', previous);
  const b = (await count()) - 1;
  await settle(b, 200, 'TEST ONLY current B');
  await page.getByRole('heading', { name: 'TEST ONLY current B' }).waitFor();
  await settle(oldA, 503, 'TEST ONLY stale A failure');
  await page.waitForTimeout(50);
  check('success not overwritten by stale failure', await page.getByRole('heading', { name: 'TEST ONLY current B' }).count() === 1);
  previous = await count();
  await page.getByRole('link', { name: 'All resources / Review', exact: true }).click(); await waitNext('review', previous);
  const oldAuth = (await count()) - 1;
  previous = await count();
  await page.getByRole('navigation', { name: 'Management navigation' }).getByRole('link', { name: 'Faculty Resources', exact: true }).click(); await waitNext('mine', previous);
  await settle((await count()) - 1, 200, 'TEST ONLY current B');
  await page.getByRole('heading', { name: 'TEST ONLY current B' }).waitFor();
  await settle(oldAuth, 401, 'TEST ONLY stale session failure');
  await page.waitForTimeout(50);
  check('stale 401 cannot clear current session', page.url().includes('/manage/hub') && await page.getByRole('heading', { name: 'TEST ONLY current B' }).count() === 1);
  // A starts, B remains loading; stale success may not end B's loading state.
  previous = await count();
  await page.getByRole('link', { name: 'All resources / Review', exact: true }).click(); await waitNext('review', previous);
  const oldSuccess = (await count()) - 1;
  previous = await count();
  await page.evaluate(() => { history.pushState(null, '', '/manage/hub?page=2'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitNext('mine', previous);
  const current = (await count()) - 1;
  await settle(oldSuccess, 200, 'TEST ONLY stale success');
  await page.waitForTimeout(50);
  check('stale success cannot end current loading', await page.getByText('Loading Faculty Resources…', { exact: true }).count() === 1);
  await settle(current, 503, 'TEST ONLY real failure');
  await page.getByRole('heading', { name: 'Faculty Resources unavailable', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(previous => window.__facultyLoads.length > previous, current + 1);
  await settle((await count()) - 1, 200, 'TEST ONLY retry success');
  await page.getByRole('heading', { name: 'TEST ONLY retry success' }).waitFor(); check('retry after real failure');
  // Aborted network failure and cancelled pending load on route unmount.
  previous = await count();
  await page.getByRole('link', { name: 'All resources / Review', exact: true }).click(); await waitNext('review', previous);
  const cancelled = (await count()) - 1;
  await page.getByRole('navigation', { name: 'Management navigation' }).getByRole('link', { name: 'Management', exact: true }).click();
  await page.evaluate(index => window.__facultyLoads[index].fail(), cancelled);
  await page.getByRole('heading', { name: 'Management', exact: true }).waitFor(); check('unmount cancellation ignored');
  await context.close();
}
async function errorsAndAuth() {
  const context = await browser.newContext(); await login(context);
  const page = await context.newPage(); monitor(page);
  for (const [status, body, heading] of [[403, { error: 'TEST ONLY forbidden' }, 'Access denied'], [404, { error: 'TEST ONLY not found' }, 'Resource not available'], [429, { error: 'TEST ONLY limited' }, 'Faculty Resources unavailable'], [500, { error: 'TEST ONLY backend error' }, 'Faculty Resources unavailable'], [200, null, 'Faculty Resources unavailable']]) {
    await page.route('**/api/hub/entries?*', route => route.fulfill({ status, json: body }));
    await page.goto(base + '/manage/hub'); await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    check('real failure classification ' + status + (body === null ? ' malformed' : ''));
    check('one workspace error, no duplicate alerts ' + status, await page.locator('.faculty-workspace[role="alert"]').count() === 1);
    await page.unroute('**/api/hub/entries?*'); await forward(page);
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('link', { name: 'My resources', exact: true }).waitFor();
    check('real failure Retry recovery ' + status);
    if (status === 500) {
      for (const name of ['All resources / Review', 'Create resource', '← Faculty Resources', 'Published resources', 'Manage Faculty Resources →']) await page.locator('main').getByRole('link', { name, exact: true }).click();
      const navigation = page.getByRole('navigation', { name: 'Management navigation' });
      for (const name of ['Management', 'Papers', 'Faculty Resources']) await navigation.getByRole('link', { name, exact: true }).click();
      await page.getByRole('link', { name: 'My resources', exact: true }).waitFor();
      check('rapid switching after Retry remains healthy');
    }
    await page.unroute('**/api/hub/**');
  }
  await page.route('**/api/hub/entries?*', route => route.abort('failed'));
  await page.goto(base + '/manage/hub'); await page.getByRole('heading', { name: 'Faculty Resources unavailable', exact: true }).waitFor(); check('real network failure surfaced');
  await page.unroute('**/api/hub/entries?*'); await forward(page);
  await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('link', { name: 'My resources', exact: true }).waitFor(); check('network Retry recovery');
  await page.unroute('**/api/hub/**');
  await page.route('**/api/hub/entries?*', route => route.fulfill({ status: 401, json: { error: 'TEST ONLY expired session' } }));
  await page.goto(base + '/manage/hub'); await page.waitForURL('**/login'); check('401 session handled by auth redirect');
  await context.close();
  const learner = await browser.newContext(); await login(learner, 'learner'); const lp = await learner.newPage(); monitor(lp); await forward(lp);
  await lp.goto(base + '/innovation-hub?view=faculty'); await lp.getByText('TEST ONLY Published Faculty Resource', { exact: true }).waitFor();
  check('learner sees no private resources', !/TEST ONLY (Pending|Rejected)/.test(await lp.locator('main').innerText()));
  await lp.goto(base + '/manage/hub'); await lp.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor(); check('learner management denied');
  await learner.close();
  const anonymous = await browser.newContext(); const ap = await anonymous.newPage(); monitor(ap);
  await ap.goto(base + '/innovation-hub?view=faculty'); await ap.waitForURL('**/login'); check('anonymous login required'); await anonymous.close();
}
(async () => {
  await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true, channel: 'msedge' });
  for (const width of [390, 820, 1440]) await rapidFlows(width);
  await raceCases(); await errorsAndAuth();
  check('no unhandled console exceptions', pageErrors.length === 0); check('zero learning writes', learningWrites.length === 0);
  console.log(JSON.stringify({ checks: checks.length, pageErrors, learningWrites }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, requests, pageErrors, learningWrites }, null, 2));
  await browser?.close();
});
