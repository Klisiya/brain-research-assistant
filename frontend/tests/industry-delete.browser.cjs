/* R8A2.1 TEST ONLY: real isolated Hub API + temporary uploads, headless Edge. */
const { chromium } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const base = process.env.HUB_TEST_ORIGIN || 'http://127.0.0.1:5177';
const output = process.env.HUB_TEST_OUTPUT || 'tmp/r8a2-1/browser';
const fixturePath = process.env.HUB_TEST_FIXTURE || 'tmp/r8a2/fixture.json';
const api = '/api/hub/industry/entries', manage = '/manage/hub/industry';
const checks = [], errors = [], learningWrites = [];
let browser;
function check(name, value = true) { assert.ok(value, name); checks.push(name); }
async function login(context, name) {
  const csrf = (await (await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  assert.equal((await context.request.post(base+'/api/auth/login', {headers:{'X-CSRF-Token':csrf},data:{email:name+'@example.test',password:'TEST-ONLY-R8A1-password'}})).status(), 200);
}
async function request(context, url, method, data, multipart) {
  const csrf = (await (await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  return context.request.fetch(base+url, {method, headers:{'X-CSRF-Token':csrf}, ...(multipart ? {multipart} : {data})});
}
async function create(context, suffix) {
  const response = await request(context, api, 'POST', {title:'TEST ONLY Delete '+suffix, body:'TEST ONLY deletion fixture', sourceName:'TEST ONLY source'});
  assert.equal(response.status(),201); return (await response.json()).entry;
}
async function action(context, entry, value, extra={}) {
  const response = await request(context, `${api}/${entry.id}/${value}`, 'POST', {expectedVersion:entry.version,...extra});
  assert.equal(response.status(),200); return (await response.json()).entry;
}
async function layout(page, name, width) {
  check(name+' no overflow '+width, await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(name+' touch/wording '+width, await page.locator('main').evaluate(main=>
    !/\b(enroll|enrolled|enrollment)\b/i.test(main.innerText) && [...main.querySelectorAll('button')].filter(el=>el.getClientRects().length).every(el=>el.getBoundingClientRect().height>=44)));
  await page.screenshot({path:path.join(output,`${name}-${width}.png`),fullPage:true});
}
async function deleteInUI(page, label, width, retry=false) {
  const trigger = page.getByRole('button',{name:label,exact:true}); await trigger.click();
  const dialog = page.getByRole('dialog'), confirm = dialog.getByRole('button',{name:label,exact:true});
  await dialog.waitFor(); const permanent=label==='Delete permanently';
  if(permanent){check('DELETE required '+width,await confirm.isDisabled());await dialog.getByLabel('Type DELETE to continue').fill('delete');check('case-sensitive confirmation '+width,await confirm.isDisabled());}
  else check('draft uses explicit button confirmation '+width,await confirm.isEnabled()&&await dialog.locator('input').count()===0);
  await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
  check('Escape focus restore '+width,await trigger.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
  await trigger.click(); if(permanent)await dialog.getByLabel('Type DELETE to continue').fill('DELETE');
  await page.keyboard.press('Tab'); check('dialog keyboard focus '+width,await dialog.evaluate(el=>el.contains(document.activeElement)));
  await layout(page,'delete-dialog-'+label.replaceAll(' ','-'),width);
  if(retry) {
    const url = '**'+api+'/*';
    const fail = route=>route.request().method()==='DELETE' ? route.fulfill({status:503,json:{error:'TEST ONLY deletion temporarily unavailable'}}) : route.continue();
    await page.route(url,fail); await confirm.click();
    await dialog.getByRole('alert').filter({hasText:'TEST ONLY deletion temporarily unavailable'}).waitFor();
    check('real failure keeps confirmation available '+width,await confirm.isEnabled());
    await page.unroute(url,fail);
  }
  await confirm.click(); await page.waitForURL(base+manage); await page.getByText('Update permanently deleted.',{exact:true}).waitFor();
  check('successful deletion feedback '+width);
}
(async()=>{
  assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
  const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8')); assert.match(fixture.database,/tmp[\\/]r8a2[\\/]/);
  await fs.mkdir(output,{recursive:true});browser=await chromium.launch({headless:true,channel:'msedge'});
  const teacher=await browser.newContext({reducedMotion:'reduce'}),admin=await browser.newContext({reducedMotion:'reduce'}),other=await browser.newContext(),learner=await browser.newContext();
  await login(teacher,'teacher'); await login(admin,'admin'); await login(other,'teacher-b'); await login(learner,'learner');
  const page=await teacher.newPage(), ap=await admin.newPage();
  for(const p of [page,ap]) {
    p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(/\/api\/(learning|reading|progress)(\/|\?)/.test(r.url())&&!['GET','HEAD'].includes(r.method()))learningWrites.push(r.url());});
  }
  for(const width of [390,820,1440]) {
    await page.setViewportSize({width,height:width===390?844:1000});await ap.setViewportSize({width,height:width===390?844:1000});
    let draft=await create(teacher,'Draft '+width);
    check('foreign teacher delete denied '+width,(await request(other,`${api}/${draft.id}`,'DELETE',{expectedVersion:draft.version,confirmation:'DELETE'})).status()===404);
    await page.goto(base+manage+'/'+draft.id);await page.getByRole('heading',{name:'Danger zone',exact:true}).waitFor();
    await layout(page,'draft-danger',width);await deleteInUI(page,'Delete draft',width,width===390);
    check('deleted draft manage denied '+width,(await teacher.request.get(base+api+'/'+draft.id+'/manage')).status()===404);
    let pending=await action(teacher,await create(teacher,'Rejected '+width),'submit');
    await page.goto(base+manage+'/'+pending.id);await page.getByText('Withdraw this pending update to Draft before deleting it.',{exact:true}).waitFor();
    check('pending has no Delete '+width,await page.getByRole('button',{name:'Delete draft',exact:true}).count()===0);
    let rejected=await action(admin,pending,'reject',{reviewNote:'TEST ONLY invalid'});
    await page.reload();await page.getByRole('button',{name:'Delete draft',exact:true}).waitFor();await deleteInUI(page,'Delete draft',width);
    let published=await create(teacher,'Published '+width);
    const upload=await request(teacher,`${api}/${published.id}/attachments`,'POST',null,{
      expectedVersion:String(published.version),displayName:'TEST ONLY delete PDF',attachmentType:'pdf',
      file:{name:'TEST-ONLY.pdf',mimeType:'application/pdf',buffer:await fs.readFile('tmp/r8a2/TEST-ONLY.pdf')},
    });assert.equal(upload.status(),201);published=(await upload.json()).entry;
    published=await action(admin,await action(teacher,published,'submit'),'approve');
    const download=published.published.attachments[0].downloadUrl;
    check('published attachment accessible before deletion '+width,(await learner.request.get(base+download)).status()===200);
    check('published searchable before deletion '+width,(await(await learner.request.get(base+'/api/search?q='+encodeURIComponent(published.published.title)+'&type=hub')).json()).total===1);
    await page.goto(base+manage+'/'+published.id);await page.getByRole('button',{name:'Create revision',exact:true}).waitFor();
    check('teacher has no permanent deletion '+width,await page.getByRole('button',{name:/Delete/}).count()===0);
    await ap.goto(base+manage+'/'+published.id);await ap.getByRole('button',{name:'Delete permanently',exact:true}).waitFor();
    check('Archive remains a distinct action '+width,await ap.getByRole('button',{name:'Archive update',exact:true}).isVisible());
    await layout(ap,'published-danger',width);await deleteInUI(ap,'Delete permanently',width);
    check('deleted published detail unavailable '+width,(await learner.request.get(base+api+'/'+published.id)).status()===404);
    check('deleted attachment unavailable '+width,(await learner.request.get(base+download)).status()===404);
    check('deleted published no Search result '+width,(await(await learner.request.get(base+'/api/search?q='+encodeURIComponent(published.published.title)+'&type=hub')).json()).total===0);
  }
  const pending=await action(teacher,await create(teacher,'Withdraw'),'submit');
  await page.goto(base+manage+'/'+pending.id);await page.getByRole('button',{name:'Withdraw to Draft',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
  await page.getByRole('button',{name:'Delete draft',exact:true}).waitFor();check('withdraw unlocks deletion');
  await deleteInUI(page,'Delete draft',1440);
  const anonymous=await browser.newContext();check('anonymous direct DELETE denied',(await request(anonymous,api+'/1','DELETE',{expectedVersion:1,confirmation:'DELETE'})).status()===401);await anonymous.close();
  check('Faculty still available',(await learner.request.get(base+'/api/hub/entries/'+fixture.faculty.id)).status()===200);
  check('zero page errors',errors.length===0);check('zero automatic learning writes',learningWrites.length===0);
  console.log(JSON.stringify({count:checks.length,errors,learningWrites}));
  await Promise.all([teacher.close(),admin.close(),other.close(),learner.close()]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,learningWrites},null,2));await browser?.close();
});
