/* TEST ONLY: headless Edge, isolated Hub database; no production data. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const base = process.env.HUB_TEST_ORIGIN || 'http://127.0.0.1:5177';
const output = process.env.HUB_TEST_OUTPUT || 'tmp/r8a3-nav/navigation';
const fixturePath = process.env.HUB_TEST_FIXTURE || 'tmp/r8a2/fixture.json';
const home = '/innovation-hub?view=discussions';
const api = '/api/hub/discussions/entries';
const checks = [], errors = [], learningWrites = [];
let browser;

function check(name, value) { assert.ok(value, name); checks.push(name); }
async function post(context, url, data) {
  const csrf = await (await context.request.get(base + '/api/auth/csrf')).json();
  return context.request.post(base + url, { headers: { 'X-CSRF-Token': csrf.csrfToken }, data });
}
async function login(context, name) {
  assert.equal((await post(context, '/api/auth/login', {
    email: name + '@example.test', password: 'TEST-ONLY-R8A1-password',
  })).status(), 200);
}
async function create(context, url, data) {
  const response = await post(context, url, data);
  assert.equal(response.status(), 201);
  return (await response.json()).entry;
}
async function index(page) {
  await page.goto(base + home);
  await page.getByRole('button', { name: 'Published threads', exact: true }).waitFor();
}
async function back(page) {
  const link = page.getByRole('link', { name: '← Learner Discussions', exact: true });
  assert.equal(await link.getAttribute('href'), home);
  await link.click();
  await page.getByRole('button', { name: 'Published threads', exact: true }).waitFor();
}
async function run() {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assert.match(fixture.database, /tmp[\\/]r8a2[\\/]/);
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const learner = await browser.newContext({ reducedMotion: 'reduce' });
  const admin = await browser.newContext({ reducedMotion: 'reduce' });
  await login(learner, 'learner'); await login(admin, 'admin');
  const publishedTitle = `TEST ONLY Navigation Published ${Date.now()}`;
  let thread = await create(admin, api, { title: publishedTitle, body: 'TEST ONLY neutral navigation fixture.' });
  const published = await post(admin, `${api}/${thread.id}/publish`, { expectedVersion: thread.version });
  assert.equal(published.status(), 200);
  thread = (await published.json()).entry;
  const draft = await create(learner, api, { title: 'TEST ONLY Navigation Draft', body: 'TEST ONLY private navigation fixture.' });
  const reply = await create(learner, `${api}/${thread.id}/replies`, { body: 'TEST ONLY private reply navigation fixture.' });

  for (const [role, context] of [['learner', learner], ['admin', admin]]) {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/api\/(learning|reading|progress)(\/|\?)/.test(request.url()) && !['GET', 'HEAD'].includes(request.method())) learningWrites.push(request.url());
    });
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await index(page);
      const workspace = page.locator('.discussion-workspace');
      const header = workspace.locator('.discussion-index-header');
      const createLink = header.getByRole('link', { name: 'Create thread', exact: true });
      check(`${role} ${width}: four Hub tabs retained`, await page.getByRole('navigation', { name: 'Innovation Hub views' }).getByRole('link').count() === 4);
      check(`${role} ${width}: one section heading`, await workspace.getByRole('heading', { name: 'Learner Discussions', exact: true }).count() === 1);
      check(`${role} ${width}: Create thread in header`, await createLink.count() === 1 && await workspace.getByRole('link', { name: 'Create thread', exact: true }).count() === 1);
      check(`${role} ${width}: no self-back or duplicate My link`, await workspace.getByRole('link', { name: '← Learner Discussions', exact: true }).count() === 0 && await workspace.getByRole('link', { name: 'My discussions', exact: true }).count() === 0);
      check(`${role} ${width}: two list selectors only`, await workspace.locator('.faculty-actions button').count() === 2);
      await page.getByRole('button', { name: 'My discussions', exact: true }).click();
      await page.waitForURL(/scope=mine/);
      await workspace.locator('button[aria-pressed="true"]').filter({ hasText: /^My discussions$/ }).waitFor();
      check(`${role} ${width}: My discussions switches`, await page.getByRole('button', { name: 'My discussions', exact: true }).getAttribute('aria-pressed') === 'true');
      await page.getByRole('button', { name: 'Published threads', exact: true }).click();
      await workspace.locator('button[aria-pressed="true"]').filter({ hasText: /^Published threads$/ }).waitFor();
      await page.getByRole('link', { name: publishedTitle, exact: true }).waitFor();
      check(`${role} ${width}: Published threads switches`, await page.getByRole('button', { name: 'Published threads', exact: true }).getAttribute('aria-pressed') === 'true');
      const layout = await workspace.evaluate(element => ({
        overflow: document.documentElement.scrollWidth > innerWidth || element.scrollWidth > element.clientWidth,
        targets: [...element.querySelectorAll('.faculty-actions a,.faculty-actions button')].every(target => target.getBoundingClientRect().height >= 44),
        terms: /\b(enroll|enrolled|enrollment)\b/i.test(element.innerText),
      }));
      check(`${role} ${width}: no overflow, 44px controls, no enrollment wording`, !layout.overflow && layout.targets && !layout.terms);
      await page.screenshot({ path: path.join(output, `${role}-${width}.png`), fullPage: true });
      await page.keyboard.press('Tab');
      await createLink.focus();
      check(`${role} ${width}: visible keyboard focus`, await createLink.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'));
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'New Discussion', exact: true }).waitFor();
      check(`${role} ${width}: create page has no redundant Create link`, await workspace.getByRole('link', { name: 'Create thread', exact: true }).count() === 0);
      await back(page);
      check(`${role} ${width}: keyboard Create and create Back work`, new URL(page.url()).search === '?view=discussions');
      await page.goto(base + '/innovation-hub/discussions/' + thread.id);
      await page.getByRole('heading', { name: publishedTitle, exact: true }).waitFor();
      await back(page);
      check(`${role} ${width}: detail Back retained`, new URL(page.url()).search === '?view=discussions');
      for (const [name, entry] of [['Thread', draft], ['Reply', reply]]) {
        await page.goto(base + '/innovation-hub/discussions/manage/' + entry.id);
        await page.getByRole('heading', { name: 'Manage ' + name, exact: true }).waitFor();
        await back(page);
        check(`${role} ${width}: manage ${name} Back retained`, new URL(page.url()).search === '?view=discussions');
      }
      if (role === 'admin') {
        await page.goto(base + '/manage/hub/discussions');
        await workspace.getByRole('button', { name: 'Review queue', exact: true }).waitFor();
        const navigation = workspace.getByRole('navigation', { name: 'Discussion navigation', exact: true });
        check(`admin ${width}: plain review heading, Create inside unified toolbar`, await workspace.getByRole('heading', { name: 'Discussion Review', level: 1, exact: true }).count() === 1 && await navigation.getByRole('link', { name: 'Create thread', exact: true }).count() === 1 && await workspace.locator('.discussion-index-header').count() === 0);
        check(`admin ${width}: one toolbar with contextual links`, await navigation.count() === 1 && await navigation.getByRole('link').count() === 2 && await navigation.getByRole('link', { name: 'My discussions', exact: true }).count() === 0);
        check(`admin ${width}: five view selectors, no duplicate filter row`, await navigation.getByRole('button').count() === 5 && await workspace.locator('.faculty-actions button').count() === 5);
        for (const [scope, label] of [['all', 'All discussions'], ['mine', 'My discussions'], ['published', 'Published threads'], ['review', 'Review queue']]) {
          await workspace.getByRole('button', { name: label, exact: true }).click();
          await workspace.locator('button[aria-pressed="true"]').filter({ hasText: new RegExp('^' + label + '$') }).waitFor();
          check(`admin ${width}: review ${scope} filter works`, new URL(page.url()).pathname === '/manage/hub/discussions' && new URL(page.url()).searchParams.get('scope') === scope);
        }
        check(`admin ${width}: review header remains stable`, await workspace.getByRole('heading', { name: 'Discussion Review', exact: true }).count() === 1);
        const reviewLayout = await workspace.evaluate(element => ({
          overflow: document.documentElement.scrollWidth > innerWidth || element.scrollWidth > element.clientWidth,
          targets: [...element.querySelectorAll('.faculty-actions a,.faculty-actions button')].every(target => target.getBoundingClientRect().height >= 44),
        }));
        check(`admin ${width}: review no overflow and 44px controls`, !reviewLayout.overflow && reviewLayout.targets);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForFunction(() => window.scrollY === 0);
        await page.screenshot({ path: path.join(output, `admin-review-${width}.png`), fullPage: true });
        await navigation.getByRole('button', { name: 'Reports queue', exact: true }).click();
        await workspace.getByRole('heading', { name: 'Discussion Reports', exact: true }).waitFor();
        check(`admin ${width}: Reports queue stays in same workspace`, new URL(page.url()).pathname === '/manage/hub/discussions' && new URL(page.url()).searchParams.get('scope') === 'reports' && await workspace.getByRole('heading', { name: 'Discussion Review', exact: true }).count() === 1);
        const reportStatus = workspace.getByRole('group', { name: 'Report status', exact: true });
        for (const status of ['open', 'resolved', 'dismissed', 'all']) {
          const label = status[0].toUpperCase() + status.slice(1);
          await reportStatus.getByRole('button', { name: label, exact: true }).click();
          await reportStatus.locator('button[aria-pressed="true"]').filter({ hasText: new RegExp('^' + label + '$') }).waitFor();
          check(`admin ${width}: report ${status} filter preserves workspace`, new URL(page.url()).pathname === '/manage/hub/discussions' && new URL(page.url()).searchParams.get('scope') === 'reports' && new URL(page.url()).searchParams.get('status') === status);
        }
        await page.goBack();
        await reportStatus.locator('button[aria-pressed="true"]').filter({ hasText: /^Dismissed$/ }).waitFor();
        await page.goForward();
        await reportStatus.locator('button[aria-pressed="true"]').filter({ hasText: /^All$/ }).waitFor();
        await page.reload();
        await reportStatus.locator('button[aria-pressed="true"]').filter({ hasText: /^All$/ }).waitFor();
        check(`admin ${width}: report history and refresh preserve selected view`, new URL(page.url()).searchParams.get('scope') === 'reports');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: path.join(output, `admin-reports-${width}.png`), fullPage: true });
        await page.goto(base + '/manage/hub/discussions/reports?status=resolved&page=1');
        await page.waitForURL(url => url.pathname === '/manage/hub/discussions' && url.searchParams.get('scope') === 'reports');
        await reportStatus.locator('button[aria-pressed="true"]').filter({ hasText: /^Resolved$/ }).waitFor();
        check(`admin ${width}: old Reports URL redirects with filter intact`, new URL(page.url()).searchParams.get('page') === '1');
        await navigation.getByRole('button', { name: 'Review queue', exact: true }).click();
        await workspace.locator('button[aria-pressed="true"]').filter({ hasText: /^Review queue$/ }).waitFor();
        check(`admin ${width}: review switch removes report content`, await workspace.getByRole('heading', { name: 'Discussion Reports', exact: true }).count() === 0);
        const reviewCreate = navigation.getByRole('link', { name: 'Create thread', exact: true });
        await page.keyboard.press('Tab'); await reviewCreate.focus();
        check(`admin ${width}: review Create focus visible`, await reviewCreate.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'));
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'New Discussion', exact: true }).waitFor();
        check(`admin ${width}: review Create opens form without self-link`, await workspace.getByRole('link', { name: 'Create thread', exact: true }).count() === 0);
        await back(page);
        await page.goto(base + '/manage/hub/discussions');
        await workspace.getByRole('heading', { name: 'Discussion Review', exact: true }).waitFor();
        await back(page);
        check(`admin ${width}: review Create and list Back retained`, new URL(page.url()).search === '?view=discussions');
      }
    }
    await page.close();
  }
  check('no unhandled browser errors', errors.length === 0);
  check('zero automatic learning writes', learningWrites.length === 0);
  await learner.close(); await admin.close();
}
run().then(() => console.log(JSON.stringify({ count: checks.length, errors, learningWrites })))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, learningWrites }, null, 2));
    await browser?.close();
  });
