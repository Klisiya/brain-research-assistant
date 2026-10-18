/* TEST ONLY: isolated account database + mail sink; headless Edge, never real users. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const base = process.env.ACCOUNT_TEST_ORIGIN || 'http://127.0.0.1:5178';
const fixturePath = process.env.ACCOUNT_TEST_FIXTURE || 'tmp/direct-account/fixture.json';
const output = process.env.ACCOUNT_TEST_OUTPUT || 'tmp/direct-account/browser';
const api = '/api/admin/users', checks = [], errors = [], learningWrites = [];
let browser;
function check(name, value=true) { assert.ok(value,name);checks.push(name); }
async function post(context,url,data) {
  const csrf=(await(await context.request.get(base+'/api/auth/csrf')).json()).csrfToken;
  return context.request.post(base+url,{headers:{'X-CSRF-Token':csrf},data});
}
async function login(context,name,password='TEST-ONLY-direct-admin-password') {
  const response=await post(context,'/api/auth/login',{email:name.includes('@')?name:name+'@example.test',password});assert.equal(response.status(),200);
}
function watch(page) {
  page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/api\/(learning|reading|progress)(\/|\?)/.test(request.url())&&!['GET','HEAD'].includes(request.method()))learningWrites.push(request.url());});
}
async function open(page) {
  await page.getByRole('button',{name:'Create Account',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Create Account',exact:true}).waitFor();return dialog;
}
async function fill(dialog,name,email,role='student',password='TEST-ONLY-manual-password-42') {
  await dialog.getByLabel('Username',{exact:true}).fill(name);await dialog.getByLabel('Email',{exact:true}).fill(email);
  await dialog.getByLabel('Role',{exact:true}).selectOption(role);await dialog.getByLabel('Temporary password',{exact:true}).fill(password);
}
async function layout(page,dialog,name,width) {
  const metrics=await dialog.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,overflow:el.scrollWidth>el.clientWidth,
    controls:[...el.querySelectorAll('button')].filter(button=>button.getClientRects().length).every(button=>button.getBoundingClientRect().height>=44)}));
  check(name+' fits viewport '+width,metrics.left>=0&&metrics.right<=width&&!metrics.overflow&&metrics.controls);
  check(name+' page no overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,`${name}-${width}.png`)});
}
async function viewports() {
  for(const [width,role] of [[390,'student'],[820,'teacher'],[1440,'admin']]) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
    await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await login(context,'admin');
    const page=await context.newPage();watch(page);await page.goto(base+'/admin/users?q=TEST-NO-MATCH');
    await page.getByRole('heading',{name:'No Matching Users',exact:true}).waitFor();const trigger=page.getByRole('button',{name:'Create Account',exact:true});
    check('Create Account is outside Invitations '+width,await trigger.evaluate(el=>el.closest('header')!==null));
    let dialog=await open(page);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    check('Escape restores trigger focus '+width,await trigger.evaluate(el=>el===document.activeElement&&getComputedStyle(el).outlineStyle!=='none'));
    dialog=await open(page);const name='TEST ONLY New '+role+' '+width,email=`direct-${width}@example.test`;
    await fill(dialog,name,email,role);
    if(width!==820) {
      await dialog.getByRole('button',{name:'Generate secure password',exact:true}).click();
      check('secure generation shape '+width,/^[A-Za-z0-9_-]{24}$/.test(await dialog.getByLabel('Temporary password',{exact:true}).inputValue()));
    }
    const password=await dialog.getByLabel('Temporary password',{exact:true}).inputValue();
    await dialog.getByRole('button',{name:'Copy password',exact:true}).click();await dialog.getByText('Copied to clipboard.',{exact:true}).waitFor();
    check('copy password before creation '+width,await page.evaluate(()=>navigator.clipboard.readText())===password);
    if(role==='admin') {
      check('admin requires confirmation',await dialog.getByRole('button',{name:'Create Account',exact:true}).isDisabled());
      await dialog.getByLabel('I confirm this account should have administrator access.',{exact:true}).check();
    }
    await page.keyboard.press('Tab');check('keyboard stays inside modal '+width,await dialog.evaluate(el=>el.contains(document.activeElement)));
    await layout(page,dialog,'create-form',width);
    const count=[];const listener=request=>{if(new URL(request.url()).pathname===api&&request.method()==='POST')count.push(1);};page.on('request',listener);
    await dialog.getByRole('button',{name:'Create Account',exact:true}).evaluate(button=>{button.click();button.click();});
    await dialog.getByRole('heading',{name:'Account created',exact:true}).waitFor();page.off('request',listener);
    check('double submit creates once '+width,count.length===1);
    check('success password shown once '+width,await dialog.getByLabel('Temporary password',{exact:true}).inputValue()===password);
    await dialog.getByRole('button',{name:'Copy credentials',exact:true}).click();await dialog.getByText('Copied to clipboard.',{exact:true}).waitFor();
    const copied=await page.evaluate(()=>navigator.clipboard.readText());check('copy complete credentials '+width,copied.includes(email)&&copied.includes(password)&&copied.includes(role));
    check('password not persisted in browser storage '+width,await page.evaluate(secret=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes(secret)),password));
    await layout(page,dialog,'create-success',width);await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Manage '+name,exact:true}).waitFor();check('list refreshes and filters clear '+width,new URL(page.url()).search==='');
    const accounts=(await(await context.request.get(base+api+'?q='+email)).json()).users;
    check('one active account with correct role '+width,accounts.length===1&&accounts[0].isActive&&accounts[0].role===role);
    const detail=await(await context.request.get(base+api+'/'+accounts[0].id)).text();check('GET omits password '+width,!detail.includes(password)&&!detail.toLowerCase().includes('password'));
    const fresh=await browser.newContext();await login(fresh,email,password);check('created user logs in '+width,(await(await fresh.request.get(base+'/api/auth/me')).json()).user.id===accounts[0].id);await fresh.close();
    dialog=await open(page);check('reopen has no previous credentials '+width,await dialog.getByLabel('Temporary password',{exact:true}).inputValue()===''&&await dialog.getByRole('heading',{name:'Account created',exact:true}).count()===0);await page.keyboard.press('Escape');
    await page.goto(base+'/admin/audit-log?action=account_created&targetId='+accounts[0].id);await page.locator('tbody th[scope="row"]').filter({hasText:'account_created'}).waitFor();
    const auditText=await page.locator('main').innerText();check('audit shows actor target role without secret '+width,auditText.includes(name)&&auditText.includes('assignedRole: '+role)&&!auditText.includes(password));
    await context.close();
  }
}
async function errorsAndExistingFlows() {
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await login(context,'admin');const page=await context.newPage();watch(page);
  await page.goto(base+'/admin/users');let dialog=await open(page);
  await fill(dialog,'test only admin','different@example.test');await dialog.getByRole('button',{name:'Create Account',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'An account already uses this username.'}).waitFor();check('duplicate username form feedback');check('error receives visible focus',await dialog.getByRole('alert').evaluate(el=>el===document.activeElement));
  await fill(dialog,'TEST ONLY Duplicate email','ADMIN@EXAMPLE.TEST');await dialog.getByRole('button',{name:'Create Account',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'An account already uses this email.'}).waitFor();check('duplicate email form feedback');
  await fill(dialog,'TEST ONLY Weak','weak@example.test','student','short');await dialog.getByRole('button',{name:'Create Account',exact:true}).click();check('weak password native validation',await dialog.getByLabel('Temporary password',{exact:true}).evaluate(el=>!el.checkValidity()));
  await fill(dialog,'TEST ONLY Retry','retry@example.test');
  const fail=route=>route.request().method()==='POST'?route.fulfill({status:503,json:{code:'ACCOUNT_UNAVAILABLE',error:'TEST ONLY unavailable'}}):route.continue();
  await page.route('**/api/admin/users',fail);await dialog.getByRole('button',{name:'Create Account',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Account service is temporarily unavailable.'}).waitFor();await page.unroute('**/api/admin/users',fail);
  check('real failure preserves form for retry',await dialog.getByLabel('Username',{exact:true}).inputValue()==='TEST ONLY Retry');
  await dialog.getByRole('button',{name:'Create Account',exact:true}).click();await dialog.getByRole('heading',{name:'Account created',exact:true}).waitFor();await dialog.getByRole('button',{name:'Done',exact:true}).click();check('retry succeeds');
  await page.getByRole('button',{name:'Invite User',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Email',{exact:true}).fill('invitation-ui@example.test');await dialog.getByRole('button',{name:'Send Invitation',exact:true}).click();await dialog.getByText('Invitation sent. The recipient can set their own password.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close Invitation',exact:true}).click();check('Invite User still works');
  await page.locator('#import-users-file').setInputFiles({name:'TEST-ONLY.csv',mimeType:'text/csv',buffer:Buffer.from('email,username,role\ncsv-ui@example.test,TEST ONLY CSV,student\n')});await page.getByRole('button',{name:'Import Invitations',exact:true}).click();await page.getByText('1 invited; 0 failed.',{exact:false}).waitFor();check('CSV import still works');
  const invitations=(await(await context.request.get(base+'/api/admin/invitations')).json()).invitations;check('real invitation and CSV records exist',invitations.some(item=>item.email==='invitation-ui@example.test')&&invitations.some(item=>item.email==='csv-ui@example.test'));
  // A success result must disappear when another admin takes over this browser.
  dialog=await open(page);await fill(dialog,'TEST ONLY Account Switch','switch@example.test');await dialog.getByRole('button',{name:'Create Account',exact:true}).click();await dialog.getByRole('heading',{name:'Account created',exact:true}).waitFor();
  await context.clearCookies();await login(context,'admin-b');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await dialog.waitFor({state:'hidden'});check('account switch clears temporary credentials',await page.locator('input[readonly]').count()===0);
  await context.close();
}
async function boundaries() {
  for(const name of ['learner','teacher',null]) {
    const context=await browser.newContext();if(name)await login(context,name);const page=await context.newPage();watch(page);
    const response=await post(context,api,{username:'TEST ONLY Forbidden',email:'forbidden@example.test',role:'student',temporaryPassword:'TEST-ONLY-forbidden-password'});
    check((name||'anonymous')+' direct API rejected',response.status()===(name?403:401));
    await page.goto(base+'/admin/users');if(name)await page.getByRole('heading',{name:'Access Denied',exact:true}).waitFor();else await page.waitForURL('**/login');check((name||'anonymous')+' UI rejected');await context.close();
  }
}
(async()=>{
  assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));assert.match(fixture.database,/tmp[\\/]direct-account[\\/]/);
  await fs.mkdir(output,{recursive:true});browser=await chromium.launch({headless:true,channel:'msedge'});
  await viewports();await errorsAndExistingFlows();await boundaries();check('zero page errors',errors.length===0);check('zero automatic learning writes',learningWrites.length===0);
  console.log(JSON.stringify({count:checks.length,errors,learningWrites}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,learningWrites},null,2));await browser?.close();});
