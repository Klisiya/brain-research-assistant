// TEST ONLY: mocked APIs, isolated browser sessions, no Flask or database access.
// Run from repository root. INTRO_TEST_MODE=production serves the existing production build.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const mode = process.env.INTRO_TEST_MODE || 'development';
const output = `tmp/home-intro-r1/${mode}`;
const base = 'http://127.0.0.1:5182';
const checks = [], errors = [], calls = [], evidence = [];
let browser, server;
function ok(name, condition) { assert.ok(condition, name); checks.push(name); }
async function fixture({ width = 1440, motion = 'no-preference', authenticated = false, delay = 200, fault = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: motion, serviceWorkers: 'block' });
  await context.addInitScript(({ fault }) => {
    window.__introEvents = [];
    const record = () => {
      const el = document.querySelector('.homepage-intro');
      const event = { t: performance.now(), present: !!el, phase: el?.dataset.phase, seen: sessionStorage.getItem('brain-home-intro-seen') };
      const last = window.__introEvents.at(-1);
      if (!last || last.present !== event.present || last.phase !== event.phase || last.seen !== event.seen) window.__introEvents.push(event);
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase', 'data-home-intro', 'hidden'] });
    if (fault) {
      const query = Element.prototype.querySelector;
      Element.prototype.querySelector = function(selector) {
        if (this.classList?.contains('homepage-intro') && selector === '[data-intro-percent]') {
          if (fault === 'init') throw new Error('TEST ONLY initialization failure');
          if (fault === 'tick') return null;
        }
        return query.call(this, selector);
      };
    }
  }, { fault });
  await context.route('**/api/**', async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ path: p, method: request.method() });
    if (p === '/api/auth/me') {
      await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill({ json: authenticated ? { authenticated: true, user: { id: 901, username: 'TEST ONLY', email: 'intro@example.test', role: 'student', isActive: true } } : { authenticated: false, user: null } });
    }
    return route.fulfill({ json: p === '/api/courses' ? { courses: [] } : {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return { context, page };
}
async function open(page) {
  await page.goto(base + '/');
  await page.getByRole('button', { name: /Skip intro/ }).waitFor();
  await page.waitForFunction(() => document.querySelector('.homepage-intro')?.dataset.phase === 'mapping');
}
async function released(page, label) {
  await page.locator('.homepage-intro').waitFor({ state: 'detached' });
  const state = await page.evaluate(() => ({
    seen: sessionStorage.getItem('brain-home-intro-seen'), lock: document.body.style.overflowY,
    htmlLock: document.documentElement.style.overflowY, inert: document.querySelectorAll('.app-shell > [inert]').length,
    phase: document.querySelector('.app-shell')?.dataset.homeIntro,
  }));
  ok(`${label}: page released`, state.lock !== 'hidden' && state.htmlLock !== 'hidden' && !state.inert && state.phase === undefined);
  return state;
}
async function complete(page, label) {
  const state = await released(page, label);
  const events = await page.evaluate(() => window.__introEvents);
  evidence.push({ label, events });
  ok(`${label}: all phases through handoff`, ['signal', 'mapping', 'convergence', 'online', 'identity', 'handoff'].every(phase => events.some(e => e.phase === phase)));
  ok(`${label}: no early seen marker`, events.filter(e => e.present && e.phase !== 'handoff').every(e => e.seen === null));
  ok(`${label}: completion records session`, state.seen === '1');
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const vite = await import('../node_modules/vite/dist/node/index.js');
  if (mode === 'production') {
    server = await vite.preview({ root: path.resolve('frontend'), preview: { host: '127.0.0.1', port: 5182, strictPort: true } });
  } else {
    server = await vite.createServer({ root: path.resolve('frontend'), server: { host: '127.0.0.1', port: 5182, strictPort: true } }); await server.listen();
  }
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--enable-gpu'] });
  const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  await fs.writeFile(path.join(output, 'gpu.json'), JSON.stringify(system.gpu, null, 2));
  ok('hardware acceleration active', system.gpu.featureStatus.gpu_compositing === 'enabled' && /NVIDIA|AMD|Intel/.test(system.gpu.auxAttributes.glRenderer) && !/WARP|SwiftShader|Basic Render/i.test(system.gpu.auxAttributes.glRenderer));
  for (const width of [1440, 820, 390]) {
    const { context, page } = await fixture({ width });
    await open(page);
    ok(`fresh ${width}: intro remains after auth settles`, await page.evaluate(() => sessionStorage.getItem('brain-home-intro-seen') === null));
    ok(`intro ${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `intro-${width}.png`) });
    await complete(page, `fresh ${width}`);
    ok(`released ${width}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.navbar a[href="/research"]').click();
    await page.waitForURL('**/research');
    await page.getByRole('link', { name: /Home/, exact: false }).first().click();
    await page.locator('.app-shell .hero').waitFor();
    ok(`same session Home return ${width}: no replay`, await page.locator('.homepage-intro').count() === 0);
    await page.evaluate(() => sessionStorage.removeItem('brain-home-intro-seen'));
    await page.reload(); await page.waitForFunction(() => document.querySelector('.homepage-intro')?.dataset.phase === 'mapping');
    await complete(page, `clear and reload ${width}`);
    await context.close();
  }
  for (const action of ['skip', 'escape', 'resize', 'motion', 'hidden']) {
    const { context, page } = await fixture(); await open(page);
    const exitStarted = Date.now();
    if (action === 'skip') { const button = page.getByRole('button', { name: /Skip intro/ }); await button.focus(); await page.keyboard.press('Enter'); }
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'resize') await page.setViewportSize({ width: 820, height: 900 });
    if (action === 'motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (action === 'hidden') {
      // Headless pages cannot be backgrounded through a visible tab strip.
      // Emulate the visibility input; exercise the actual registered handler.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    const state = await released(page, action);
    ok(`${action}: exits before normal completion`, Date.now() - exitStarted < 1600);
    ok(`${action}: session consumed after intentional exit`, state.seen === '1');
    if (action === 'skip') ok('Skip keyboard focus restored to Home', await page.locator('.navbar a[href="/"]').evaluate(el => el === document.activeElement));
    await context.close();
  }
  const reduced = await fixture({ motion: 'reduce' }); await reduced.page.goto(base + '/');
  await reduced.page.waitForFunction(() => sessionStorage.getItem('brain-home-intro-seen') === '1');
  await released(reduced.page, 'initial reduced motion');
  ok('reduced motion quick exit', await reduced.page.evaluate(() => window.__introEvents.at(-1).t - window.__introEvents.find(e => e.present).t < 1600));
  await reduced.context.close();
  const slow = await fixture({ authenticated: true, delay: 1500 }); await open(slow.page); await complete(slow.page, 'slow authenticated initial remount');
  ok('authenticated fixture reached account state', await slow.page.getByRole('button', { name: 'TEST ONLY', exact: true }).isVisible());
  await slow.context.close();
  for (const fault of ['init', 'tick']) {
    const { context, page } = await fixture({ fault }); await page.goto(base + '/');
    await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
    const state = await released(page, fault + ' failure');
    ok(`${fault} failure: session not consumed`, state.seen === null);
    await context.close();
  }
  ok('no console or uncaught errors', errors.length === 0);
  ok('no API writes', calls.every(call => call.method === 'GET'));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ mode, checks, errors, calls, evidence }, null, 2));
  await browser?.close();
  if (mode === 'production') await new Promise(resolve => server?.httpServer.close(resolve)); else await server?.close();
  console.log(JSON.stringify({ mode, passed: checks.length, errors }));
});
