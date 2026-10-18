/* R8A2 TEST ONLY: requires an isolated fixture backend, never production.
 * The fixture and every attachment live in ignored tmp/r8a2. Headless Edge only.
 * HUB_TEST_ORIGIN / HUB_TEST_FIXTURE select that isolated frontend and fixture.
 */
const { chromium } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const base = process.env.HUB_TEST_ORIGIN || 'http://127.0.0.1:5177';
const output = process.env.HUB_TEST_OUTPUT || 'tmp/r8a2/browser';
const fixturePath = process.env.HUB_TEST_FIXTURE || 'tmp/r8a2/fixture.json';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const checks = [], errors = [], learningWrites = []; let browser, fixture;
const api = '/api/hub/industry/entries', manage = '/manage/hub/industry';
function check(name, value = true) { assert.ok(value, name); checks.push(name); }
function monitor(page) {
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/api\/(learning|reading|progress)\//.test(request.url()) && !['GET','HEAD'].includes(request.method())) learningWrites.push(request.url()); });
}
async function login(context, name) {
  const csrf = (await (await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  const response = await context.request.post(base+'/api/auth/login', { headers:{'X-CSRF-Token':csrf}, data:{email:name+'@example.test',password:'TEST-ONLY-R8A1-password',remember:false} });
  assert.equal(response.status(),200);
}
async function mutate(context, url, method, data) {
  const csrf = (await (await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  return context.request.fetch(base+url, { method,headers:{'X-CSRF-Token':csrf},data });
}
async function layout(page, name, width) {
  const measured = await page.locator('main').evaluate(main => ({
    overflow:document.documentElement.scrollWidth>innerWidth || main.scrollWidth>main.clientWidth,
    h1:main.querySelectorAll('h1').length,
    targets:[...main.querySelectorAll('.faculty-workspace button,.faculty-actions a,input,select')].filter(el=>el.getClientRects().length&&!el.disabled).every(el=>el.getBoundingClientRect().height>=43.9),
    terms:/\b(enroll|enrolled|enrollment|drop course)\b/i.test(main.innerText),
  }));
  check(`${name} responsive/focus/wording ${width}`, !measured.overflow && measured.h1===1 && measured.targets && !measured.terms);
  await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true});
}
async function confirm(page, action) {
  await page.getByRole('button',{name:action,exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:action==='Approve & Publish'?'Approve & Publish':'Confirm',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
}
async function viewports() {
  for (const width of [390,820,1440]) {
    const context = await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'}); await login(context,'admin');
    const page = await context.newPage(); monitor(page);
    for (const [name,route,ready] of [
      ['industry-empty','/innovation-hub?view=industry','No industry updates have been published yet.'],
      ['industry-create',manage+'/new','Source date (optional)'],
      ['industry-review',manage+'?scope=review','TEST ONLY Pending Industry Update'],
      ['industry-comparison',manage+'/'+fixture.pending.id,'Current published version'],
    ]) {
      await page.goto(base+route);
      if(name==='industry-create') await page.getByLabel(ready).waitFor(); else await page.getByText(ready,{exact:true}).first().waitFor();
      await layout(page,name,width);
    }
    const approve=page.getByRole('button',{name:'Approve & Publish',exact:true}); await approve.click(); await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Tab'); check('review dialog keyboard '+width,await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state:'hidden'});
    check('review dialog restores focus '+width,await approve.evaluate(el=>el===document.activeElement && getComputedStyle(el).outlineStyle!=='none'));
    check('only Industry management link active '+width,await page.getByRole('navigation',{name:'Management navigation'}).getByRole('link',{name:'Faculty Resources',exact:true}).getAttribute('aria-current')===null);
    await page.route('**/api/hub/industry/entries?*', route=>route.fulfill({status:503,json:{error:'TEST ONLY load failure'}}));
    await page.goto(base+'/innovation-hub?view=industry'); await page.getByRole('heading',{name:'Industry Updates unavailable',exact:true}).waitFor();
    await page.unroute('**/api/hub/industry/entries?*'); await page.getByRole('button',{name:'Retry',exact:true}).click(); await page.getByText('No industry updates have been published yet.',{exact:true}).waitFor(); check('real failure + Retry '+width);
    await context.close();
  }
}
async function lifecycle() {
  const teacher = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}), admin = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}), learner = await browser.newContext({viewport:{width:820,height:1000},reducedMotion:'reduce'});
  await login(teacher,'teacher');await login(admin,'admin');await login(learner,'learner');
  const tp=await teacher.newPage(),ap=await admin.newPage(),lp=await learner.newPage(); [tp,ap,lp].forEach(monitor);
  await tp.goto(base+manage+'/new');await tp.getByLabel('Title',{exact:true}).fill('TEST ONLY BrowserLiveAlpha');await tp.getByLabel('Description',{exact:true}).fill('TEST ONLY original manual description.');await tp.getByLabel('Source name',{exact:true}).fill('TEST ONLY neutral source');await tp.getByLabel('Source URL (optional)').fill('https://example.test/source');await tp.getByLabel('Source date (optional)').fill('2020-01-02');
  await tp.getByRole('button',{name:'Save Draft',exact:true}).click();await tp.waitForURL(/\/manage\/hub\/industry\/\d+$/); const id=Number(new URL(tp.url()).pathname.split('/').at(-1));
  await tp.getByRole('button',{name:'Submit for Review',exact:true}).waitFor(); check('teacher creates draft through real API');
  await tp.getByLabel('Material name').fill('TEST ONLY original PDF');await tp.getByLabel('File',{exact:true}).setInputFiles('tmp/r8a2/TEST-ONLY.pdf');await tp.getByRole('button',{name:'Add material',exact:true}).click();await tp.getByText('Material added to draft.',{exact:true}).waitFor();
  await confirm(tp,'Submit for Review');await tp.getByText('Pending Review',{exact:true}).waitFor(); check('teacher submits; no self approval button',await tp.getByRole('button',{name:'Approve & Publish'}).count()===0);
  await tp.reload();await tp.getByText('Pending Review',{exact:true}).waitFor();check('pending refresh persistence');
  await ap.goto(base+manage+'/'+id);await ap.getByLabel('Rejection reason').fill('TEST ONLY please revise');await confirm(ap,'Reject');await ap.getByText('Rejected',{exact:true}).waitFor();check('admin rejects new update');
  await tp.reload();await tp.getByRole('button',{name:'Revise rejected update',exact:true}).click();await tp.getByLabel('Description',{exact:true}).fill('TEST ONLY corrected manual description.');await tp.getByRole('button',{name:'Save Draft',exact:true}).click();await tp.getByText('Draft saved.',{exact:true}).waitFor();await confirm(tp,'Submit for Review');await tp.getByText('Pending Review',{exact:true}).waitFor();
  await ap.reload();await confirm(ap,'Approve & Publish');await ap.getByText('Approved and published.',{exact:true}).waitFor();check('rejected edit/resubmit/approve');
  await lp.goto(base+'/innovation-hub/industry/'+id);await lp.getByText('TEST ONLY corrected manual description.',{exact:true}).waitFor();await lp.getByText('Source date:',{exact:false}).waitFor();check('learner sees current published and real source date');
  const v1=(await(await learner.request.get(base+api+'/'+id)).json()).entry;
  const oldUrl=v1.published.attachments[0].downloadUrl;
  await tp.reload();await tp.getByRole('button',{name:'Create revision',exact:true}).click();await tp.getByLabel('Title',{exact:true}).fill('TEST ONLY BrowserPendingBeta');await tp.getByLabel('Description',{exact:true}).fill('TEST ONLY changed description awaiting review.');await tp.getByLabel('Source date (optional)').fill('2021-03-04');await tp.getByRole('button',{name:'Save Draft',exact:true}).click();await tp.getByText('Draft saved.',{exact:true}).waitFor();
  await tp.getByRole('button',{name:'Remove TEST ONLY original PDF',exact:true}).click();await tp.getByText('Material removed from draft.',{exact:true}).waitFor();
  await tp.getByLabel('Material name').fill('TEST ONLY revision image');await tp.getByLabel('Material type').selectOption('cover');await tp.getByLabel('File',{exact:true}).setInputFiles('tmp/r8a2/TEST-ONLY.png');await tp.getByRole('button',{name:'Add material',exact:true}).click();await tp.getByText('Material added to draft.',{exact:true}).waitFor();await confirm(tp,'Submit for Review');await tp.getByText('Pending Revision v3:',{exact:false}).waitFor();
  const managed=(await(await teacher.request.get(base+api+'/'+id+'/manage')).json()).entry, newUrl=managed.working.attachments[0].downloadUrl;
  await lp.reload();await lp.getByText('TEST ONLY corrected manual description.',{exact:true}).waitFor();check('pending revision does not overwrite live page',!(await lp.locator('main').innerText()).includes('BrowserPendingBeta'));
  check('pending image denied, old PDF retained',(await learner.request.get(base+newUrl)).status()===404&&(await learner.request.get(base+oldUrl)).status()===200);
  check('pending revision not in Search',(await(await learner.request.get(base+'/api/search?q=BrowserPendingBeta&type=hub')).json()).total===0);
  await lp.goto(base+'/search?q=BrowserPendingBeta&type=hub');await lp.getByRole('heading',{name:'No results found for “BrowserPendingBeta”',exact:true}).waitFor();check('Search UI excludes pending revision');
  await lp.goto(base+'/innovation-hub/industry/'+id);await lp.getByText('TEST ONLY corrected manual description.',{exact:true}).waitFor();
  await ap.reload();await ap.getByRole('heading',{name:'Current published version',exact:true}).waitFor();await ap.getByRole('heading',{name:'Pending revision v3',exact:true}).waitFor();
  for(const width of [390,820,1440]){await ap.setViewportSize({width,height:width===390?844:1000});await layout(ap,'published-vs-pending',width);}
  check('admin can compare current vs proposed content',(await ap.locator('.industry-comparison').innerText()).includes('BrowserLiveAlpha')&&(await ap.locator('.industry-comparison').innerText()).includes('BrowserPendingBeta'));
  await ap.getByLabel('Rejection reason').fill('TEST ONLY revision not accepted');await confirm(ap,'Reject');await ap.getByText('Review feedback: TEST ONLY revision not accepted',{exact:true}).waitFor();
  check('rejected revision leaves v1 live',(await(await learner.request.get(base+api+'/'+id)).json()).entry.published.title==='TEST ONLY BrowserLiveAlpha');
  await tp.reload();await tp.getByRole('button',{name:'Revise rejected update',exact:true}).click();await tp.getByRole('button',{name:'Submit for Review',exact:true}).waitFor();await confirm(tp,'Submit for Review');await tp.getByText('Pending Revision v4:',{exact:false}).waitFor();
  await ap.reload();await confirm(ap,'Approve & Publish');await ap.getByText('Approved and published.',{exact:true}).waitFor();
  await lp.reload();await lp.getByRole('heading',{name:'TEST ONLY BrowserPendingBeta',exact:true,level:1}).waitFor();check('approved revision replaces live page');
  const v4=(await(await learner.request.get(base+api+'/'+id)).json()).entry;
  check('correct approved attachment replaces old',(await learner.request.get(base+v4.published.attachments[0].downloadUrl)).status()===200&&(await learner.request.get(base+oldUrl)).status()===404);
  check('Search returns one current version',(await(await learner.request.get(base+'/api/search?q=BrowserPendingBeta&type=hub')).json()).total===1&&(await(await learner.request.get(base+'/api/search?q=BrowserLiveAlpha&type=hub')).json()).total===0);
  await lp.goto(base+'/search?q=Published%20Faculty%20Resource&type=hub');await lp.getByText('Faculty Resource',{exact:true}).waitFor();await lp.getByRole('link',{name:'TEST ONLY Published Faculty Resource',exact:true}).click();await lp.waitForURL(base+'/innovation-hub/faculty/'+fixture.faculty.id);check('Faculty Search UI remains compatible');
  await lp.goto(base+'/search?q=BrowserPendingBeta&type=hub');await lp.getByText('Industry Update',{exact:true}).waitFor();await lp.getByRole('link',{name:'TEST ONLY BrowserPendingBeta',exact:true}).click();await lp.waitForURL(base+'/innovation-hub/industry/'+id);check('Industry Search UI parses labels and navigates current version');
  await ap.getByText('Review history',{exact:true}).click();check('audit distinguishes actor and source',(await ap.locator('.faculty-history').innerText()).includes('Account '+fixture.users.admin)&&(await ap.locator('.faculty-history').innerText()).includes('Source: TEST ONLY'));
  const other=await browser.newContext();await login(other,'teacher-b');check('teacher IDOR denied',(await other.request.get(base+api+'/'+id+'/manage')).status()===404);check('teacher foreign edit denied',(await mutate(other,api+'/'+id,'PATCH',{expectedVersion:managed.version,title:'TEST ONLY forbidden',body:'TEST ONLY',sourceName:'TEST ONLY'})).status()===404);await other.close();
  await tp.reload();await teacher.clearCookies();await login(teacher,'teacher-b');await tp.evaluate(()=>window.dispatchEvent(new Event('focus')));await tp.getByRole('heading',{name:'Update not available',exact:true}).waitFor();check('account switch clears old private working content',!(await tp.locator('main').innerText()).includes('changed description awaiting review'));
  await ap.getByRole('button',{name:'Archive update',exact:true}).click();await ap.getByRole('dialog').getByLabel('Type ARCHIVE to continue').fill('ARCHIVE');await ap.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await ap.getByText('Archived',{exact:true}).waitFor();await lp.reload();await lp.getByRole('heading',{name:'Update not available',exact:true}).waitFor();check('archive removes learner access and search',(await(await learner.request.get(base+'/api/search?q=BrowserPendingBeta&type=hub')).json()).total===0);
  await lp.goto(base+manage);await lp.getByRole('heading',{name:'Access Denied',exact:true}).waitFor();check('learner management blocked');
  await Promise.all([teacher.close(),admin.close(),learner.close()]);
}
async function anonymous() {
  const context=await browser.newContext();const page=await context.newPage();monitor(page);
  for(const route of ['/innovation-hub?view=industry','/innovation-hub/industry/'+fixture.pending.id,manage+'/new']){await page.goto(base+route);await page.waitForURL('**/login');check('anonymous redirect '+route);}
  check('anonymous direct API denied',(await context.request.get(base+api)).status()===401);await context.close();
}
(async()=>{
  fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));assert.match(fixture.database,/tmp[\\/]r8a2[\\/]/);
  await fs.mkdir(output,{recursive:true});browser=await chromium.launch({headless:true,channel:'msedge'});
  await viewports();await anonymous();await lifecycle();check('zero page errors',errors.length===0);check('zero automatic learning writes',learningWrites.length===0);
  console.log(JSON.stringify({count:checks.length,errors,learningWrites}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,learningWrites},null,2));await browser?.close();});
