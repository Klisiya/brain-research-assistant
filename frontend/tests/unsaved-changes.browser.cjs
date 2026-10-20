// TEST ONLY. Every API is mocked in browser memory. Never starts Flask or touches a database.
// Run from repository root with Playwright available via NODE_PATH.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.NAV_TEST_ORIGIN || 'http://127.0.0.1:5178';
const output = process.env.NAV_TEST_OUTPUT || 'tmp/nav-fix-b/browser';
const checks = [], errors = [], calls = [], unknown = [], warnings=[];
let browser, server, course, debugPage;
const now = '2026-10-18T12:00:00Z';
const revision = (title, state = 'pending') => ({ id: 1, number: 1, title, body: 'TEST ONLY neutral fixture.', state, sourceName: 'TEST ONLY', sourceUrl: null, sourceDate: null, attachments: [], publishedAt: now });
const paper = { id: 41, slug: 'test-only-paper', title: 'TEST ONLY Paper', authors: ['TEST ONLY Author'], year: null, journal: null, publicationType: 'Review', difficulty: 'Beginner', estimatedReadingMinutes: 1, topics: ['TEST ONLY'], abstract: 'TEST ONLY validation fixture.', learningObjectives: ['TEST ONLY validation objective'], keywords: [], featured: false, openAccess: false, externalUrl: null, resourceCategory: 'Foundational', createdAt: now, updatedAt: now, publishedAt: now, status: 'published', createdBy: { id: 901, username: 'TEST ONLY', role: 'teacher' }, updatedById: 901 };
const user = (role, id = 901) => ({ id, username: 'TEST ONLY ' + role, email: role + '@example.test', role, isActive: true });
function ok(label, value) { assert.ok(value, label); checks.push(label); }
const relative = p => { const u = new URL(p.url()); return u.pathname + u.search + u.hash; };
async function click(p, role, name) { await p.getByRole(role, { name, exact: true }).first().click(); }
async function goto(p, url) { await p.goto(base + url); }
function list(entries, requestedPage, size = 12) {
  const page = Number(requestedPage || 1), totalPages = Math.ceil(entries.length / size);
  return { entries: entries.slice((page - 1) * size, page * size), page, total: entries.length, totalPages };
}
async function fixture(role = 'admin') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const state = { role, id: 901, delay: 0, industry: [], faculty: [], discussions: [], reports: [], paperPages: 3, forbidden: false, failSave: false, saveDelay: 0 };
  state.area={id:1,code:'RA-01',slug:'neuroscience',name:'Neuroscience',overview:'',subtopics:[],brainRegionSlugs:[],sortOrder:1,status:'published',updatedAt:now};
  for (let i = 0; i < 25; i++) {
    for (const kind of ['industry', 'faculty']) state[kind].push({ id: (kind === 'industry' ? 201 : 101) + i, kind, status: 'pending', ownerId: 901, submittedById: 901, version: 1, published: null, working: revision(`TEST ONLY ${kind} ${i + 1}`) });
    state.discussions.push({ id: 301 + i, type: 'thread', threadId: null, author: 'TEST ONLY learner', canManage: true, isAuthor: false, status: 'pending', version: 1, published: null, working: revision(`TEST ONLY Thread ${i + 1}`) });
    for (const [index, status] of ['open', 'resolved', 'dismissed'].entries()) state.reports.push({ id: 501 + index * 100 + i, targetId: 301 + i, originalTargetId: 301 + i, threadId: null, targetType: 'thread', targetState: 'pending', reporter: 'TEST ONLY learner', reason: 'TEST ONLY reason', detail: null, status, version: 1, createdAt: now, resolvedAt: null, resolvedBy: null });
  }
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method(), q = url.searchParams;
    if (!p.startsWith('/api/')) return route.continue();
    calls.push({ role: state.role, id: state.id, path: p + url.search, method: m });
    let body, status = 200; const input = req.postDataJSON?.bind(req); let data = {}; try {data=input()||{}} catch {}
    if (!['GET','HEAD'].includes(m) && state.saveDelay && !p.startsWith('/api/auth/')) await new Promise(resolve=>setTimeout(resolve,state.saveDelay));
    if (!['GET','HEAD'].includes(m) && state.failSave && !p.startsWith('/api/auth/')) return route.fulfill({status:503,json:{error:'TEST ONLY save failure'}});
    if (p === '/api/auth/me') body = state.role === 'anonymous' ? { authenticated: false, user: null } : { authenticated: true, user: user(state.role, state.id) };
    else if (p === '/api/auth/csrf') body = { csrfToken: 'TEST-ONLY-NAV' };
    else if (p === '/api/auth/logout') { state.role = 'anonymous'; body = { success: true }; }
    else if (p === '/api/courses/1/manage') body={course};
    else if (p === '/api/courses/1' && m==='PATCH') {if(data.expectedUpdatedAt!==course.updatedAt){status=409;body={error:'TEST ONLY stale edit token'}}else{Object.assign(course,data,{updatedAt:now+':'+calls.length});body={saved:true}}}
    else if (/^\/api\/courses\/1\/modules\/\d+$/.test(p)&&m==='PATCH') {const row=course.modules.find(x=>x.id===Number(p.split('/')[5]));if(data.expectedUpdatedAt!==row.updatedAt){status=409;body={error:'TEST ONLY stale edit token'}}else{Object.assign(row,data,{updatedAt:now+':'+calls.length});body={saved:true}}}
    else if (p === '/api/courses/1/staff') body={staff:[]};
    else if (p === '/api/courses/editors' || p === '/api/research-areas/editors') body={users:[],total:0};
    else if (p.includes('/resources/manage')) body={resources:[]};
    else if (p === '/api/research-areas/1/manage') body={area:state.area,papers:[],modules:[],resources:[],brainRegions:[],hubContent:[]};
    else if (p === '/api/research-areas/1' && m==='PATCH') {Object.assign(state.area,data);body={area:state.area};}
    else if (p === '/api/research-areas/1/staff') body={staff:[]};
    else if (p === '/api/papers') body={papers:[],pagination:{page:1,total:0,totalPages:0}};
    else if (p === '/api/papers/41' && m==='PATCH') {Object.assign(paper,data);body={paper};}
    else if (p === '/api/courses') body={courses:[course]};
    else if (p === '/api/courses/manage') body = { courses: [] };
    else if (p === '/api/courses/' + course.slug) body = { course };
    else if (p.startsWith('/api/courses/') && p.includes('/modules/')) { if (p.endsWith('/resources')) body = { resources: [] }; else if (p.endsWith('/papers')) body = { readings: [{ relationId: 1, readingType: 'required', sortOrder: 1, paper }] }; else body = { course, module: course.modules.find(x=>x.id===Number(p.split('/')[5]))||course.modules[0] }; }
    else if (p.startsWith('/api/learning/courses/')) body = { enrollment: null };
    else if (p === '/api/research-areas/manage') body = { areas: [] };
    else if (p === '/api/learning/bookmarks') body = { bookmarks: [] };
    else if (p.endsWith('/notes') || p.endsWith('/highlights')) body = { notes: [], highlights: [], resources: [] };
    else if (p.startsWith('/api/learning/papers/')) body = { reading: { status: 'not_started', startedAt: null, selfCompletedAt: null, lastActivityAt: null, resources: [], unavailableHistory: [] } };
    else if (p === '/api/papers/manage') {
      const page = Number(q.get('page') || 1);
      body = { papers: page <= state.paperPages ? [paper] : [], pagination: { page, perPage: 20, total: state.paperPages * 20, totalPages: state.paperPages }, filters: { q: q.get('q') || '', status: q.get('status') === 'all' ? null : q.get('status'), sort: q.get('sort') || 'recommended' } };
    if (q.get('q') === 'TEST ONLY EMPTY') body = { ...body, papers: [], pagination: { page, perPage: 20, total: 0, totalPages: 0 } };
    } else if (p.endsWith('/attachments') && p.startsWith('/api/papers')) body = { attachments: [] };
    else if (p === '/api/papers/manage/41/preview') body = { paper: { ...paper, preview: true } };
    else if (p === '/api/papers/manage/41' || p === '/api/papers/test-only-paper') body = { paper };
    else if (p.startsWith('/api/hub/discussions')) {
      const suffix = p.slice('/api/hub/discussions'.length);
      if (suffix === '/reports') body = list(state.reports.filter(x => q.get('status') === 'all' || x.status === q.get('status')), q.get('page'));
      else if (/^\/reports\/\d+\/(resolve|dismiss)$/.test(suffix)) {
        const report = state.reports.find(x => x.id === Number(suffix.split('/')[2])); report.status = suffix.endsWith('/resolve') ? 'resolved' : 'dismissed'; report.version++; body = { report };
      } else if (m==='PATCH') {const entry=state.discussions.find(x=>x.id===Number(suffix.split('/')[2]));Object.assign(entry.working,data);entry.version++;body={entry};}
      else if (m==='POST' && (suffix==='/entries' || suffix.endsWith('/replies'))) {const entry={id:999,type:suffix.endsWith('/replies')?'reply':'thread',threadId:suffix.endsWith('/replies')?301:null,author:'TEST ONLY',canManage:true,isAuthor:true,status:'draft',version:1,published:null,working:revision(data.title,'draft')};entry.working.body=data.body;state.discussions.push(entry);body={entry};}
      else if (m==='POST' && suffix.endsWith('/draft')) {const entry=state.discussions.find(x=>x.id===Number(suffix.split('/')[2]));entry.working={...(entry.working||entry.published),state:'draft'};body={entry};}
      else if (suffix === '/entries') {
        const scope = q.get('scope');
        body = list(state.discussions.filter(x => scope !== 'review' || x.working?.state === 'pending').map(x => scope === 'published' ? { ...x, published: x.working, working: undefined } : x), q.get('page'));
      } else if (/^\/entries\/\d+(\/manage)?$/.test(suffix)) {
        body = { entry: state.discussions.find(x => x.id === Number(suffix.split('/')[2])) };
        if (state.forbidden) { status = 403; body = { error: 'TEST ONLY denied' }; }
      } else if (suffix.endsWith('/replies')) body = list([], 1);
      else if (suffix.endsWith('/history')) body = { entries: [], page: 1, total: 0, totalPages: 0 };
      else { unknown.push(p); status = 404; body = { error: 'TEST ONLY missing mock' }; }
    } else if (p.startsWith('/api/hub/industry/entries') || p.startsWith('/api/hub/entries')) {
      const kind = p.includes('/industry/') ? 'industry' : 'faculty', root = kind === 'industry' ? '/api/hub/industry/entries' : '/api/hub/entries', suffix = p.slice(root.length), id = Number(suffix.split('/')[1]);
      const entry = state[kind].find(x => x.id === id);
      if (m==='POST' && !suffix) {const entry={id:999,kind,status:'draft',ownerId:901,submittedById:901,version:1,published:null,working:{...revision(data.title,'draft'),...data}};state[kind].push(entry);body={entry};}
      else if(m==='PATCH') {Object.assign(entry.working,data);entry.version++;body={entry};}
      else if(m==='POST' && suffix.endsWith('/draft')) {entry.working={...(entry.working||entry.published),state:'draft',number:2};body={entry};}
      else if(m==='POST' && suffix.endsWith('/attachments')) {entry.working.attachments.push({id:71,displayName:data.displayName,attachmentType:'external_link',externalUrl:data.externalUrl});entry.version++;body={entry};}
      else if (!suffix) {
        const scope = q.get('scope');
        let entries = state[kind];
        if (scope === 'review' && kind === 'industry') entries = entries.filter(x => x.working?.state === 'pending');
        if (scope === 'published') entries = entries.map(x => ({ ...x, published: revision(x.working?.title || 'TEST ONLY published', 'approved') }));
        body = list(entries, q.get('page'));
        if (state.failList) { status = 503; body = { error: 'TEST ONLY transient list failure' }; }
      } else if (suffix.endsWith('/history')) body = { events: [] };
      else if (m === 'POST' && /\/(approve|reject)$/.test(suffix)) {
        if (suffix.endsWith('/approve')) { entry.published = { ...entry.working, state: 'approved' }; entry.working = null; entry.status = 'published'; }
        else { entry.working.state = 'rejected'; entry.status = 'rejected'; }
        entry.version++; body = { entry };
      } else {
        body = { entry };
        if (state.forbidden) { status = 403; body = { error: 'TEST ONLY denied' }; }
      }
    } else { unknown.push(p); status = 404; body = { error: 'TEST ONLY missing mock' }; }
    if (state.delay && !p.startsWith('/api/auth/')) await new Promise(resolve => setTimeout(resolve, state.delay));
    await route.fulfill({ status, json: body }).catch(() => {});
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));page.on('console', e=>{if(e.type()==='error')warnings.push({text:e.text(),url:page.url()})});
  return { context, page, state };
}
const dialog=p=>p.getByRole('dialog',{name:'Discard unsaved changes?',exact:true});
const back=p=>p.locator('.management-return').last();
async function attempt(p, trigger, label) {const url=p.url();await trigger();await dialog(p).waitFor();ok(label+' stays before decision',p.url()===url);ok(label+' one dialog',(await p.getByRole('dialog').count())===1);}
async function keep(p){await dialog(p).getByRole('button',{name:'Keep editing',exact:true}).click();await dialog(p).waitFor({state:'hidden'});}
async function discard(p){await dialog(p).getByRole('button',{name:'Discard changes',exact:true}).click();await dialog(p).waitFor({state:'hidden'});}
async function unload(p){return p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented});}
async function run(){
 await fs.mkdir(output,{recursive:true});const seed=JSON.parse(await fs.readFile('project/migrations/data/r4a_course.json','utf8'));
 course={...seed.course,id:1,status:'published',updatedAt:now,moduleCount:12,totalHours:36,categories:[],modules:seed.modules.map((m,i)=>({...m,description:m.description??'',learningFocus:m.learningFocus??'',category:m.category??'',id:i+1,status:'published',updatedAt:now}))};
 const {createServer}=await import('../node_modules/vite/dist/node/index.js');server=await createServer({root:path.resolve('frontend'),server:{host:'127.0.0.1',port:5178,strictPort:true}});await server.listen();
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const f=await fixture(),p=f.page;debugPage=p;
 await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).waitFor();ok('clean beforeunload absent',!await unload(p));await back(p).click();await p.waitForURL('**/manage/hub');ok('clean Back no dialog',await p.getByRole('dialog').count()===0);
 await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY unsaved');await attempt(p,()=>back(p).click(),'Faculty create Back');ok('dirty beforeunload active',await unload(p));ok('initial focus Keep editing',await dialog(p).getByRole('button',{name:'Keep editing'}).evaluate(e=>e===document.activeElement));await p.keyboard.press('Shift+Tab');ok('focus trapped',await dialog(p).getByRole('button',{name:'Discard changes'}).evaluate(e=>e===document.activeElement));await p.keyboard.press('Escape');await dialog(p).waitFor({state:'hidden'});ok('Escape retains text',await p.getByLabel('Title',{exact:true}).inputValue()==='TEST ONLY unsaved');ok('Escape restores trigger focus',await back(p).evaluate(e=>e===document.activeElement));
 await attempt(p,()=>back(p).click(),'Faculty discard');await discard(p);await p.waitForURL('**/manage/hub');ok('discard returns list',true);
 await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY saved');await click(p,'button','Save Draft');await p.waitForURL('**/manage/hub/999');await p.getByLabel('Title',{exact:true}).waitFor();ok('created draft clean',!await unload(p));await back(p).click();await p.waitForURL('**/manage/hub');ok('Save Draft Back no prompt',await p.getByRole('dialog').count()===0);
 for(const [kind,id] of [['faculty',101],['industry',201]]){
   const entry=f.state[kind][0];entry.status='draft';entry.working.state='draft';const url=kind==='faculty'?'/manage/hub/'+id:'/manage/hub/industry/'+id;
   await goto(p,url);const field=p.getByLabel('Title',{exact:true});const original=await field.inputValue();await field.fill('TEST ONLY edit');await attempt(p,()=>back(p).click(),kind+' Draft');await keep(p);await field.fill(original);ok(kind+' reverted clean',!await unload(p));
   await field.fill('TEST ONLY error');f.state.failSave=true;await click(p,'button','Save Draft');await p.getByText('TEST ONLY save failure',{exact:true}).waitFor();ok(kind+' save failure dirty',await unload(p));await attempt(p,()=>back(p).click(),kind+' failure Back');await keep(p);f.state.failSave=false;
   f.state.saveDelay=800;await click(p,'button','Save Draft');await back(p).click();await p.getByRole('dialog',{name:'Saving in progress',exact:true}).waitFor();ok(kind+' busy blocks exit',new URL(p.url()).pathname===url);await p.getByText('Draft saved.',{exact:true}).waitFor();await p.getByRole('dialog').waitFor({state:'hidden'});ok(kind+' successful retry clean',!await unload(p));f.state.saveDelay=0;
   // Rejected existing semantics first create an editable revision.
   entry.status='rejected';entry.working.state='rejected';await goto(p,url);await click(p,'button',kind==='faculty'?'Revise rejected resource':'Revise rejected update');await field.waitFor();await field.fill('TEST ONLY rejected edit');await attempt(p,()=>back(p).click(),kind+' rejected revision');await discard(p);await p.waitForURL(kind==='faculty'?'**/manage/hub':'**/manage/hub/industry');
   entry.status='published';entry.published={...entry.working,state:'approved',title:'TEST ONLY published'};entry.working=null;await goto(p,url);await click(p,'button',kind==='faculty'?'Create editing draft':'Create revision');await field.fill('TEST ONLY revision');await attempt(p,()=>p.getByRole('link',{name:kind==='faculty'?'View published resource →':'View published update →',exact:true}).click(),kind+' revision View published');await keep(p);await field.fill('TEST ONLY published');
   await p.getByLabel('Material name',{exact:true}).fill('TEST ONLY material');await p.getByLabel(/^Material type/).selectOption('external_link');await p.getByLabel('Link URL',{exact:true}).fill('https://example.test/material');await click(p,'button','Add material');await p.getByText(kind==='faculty'?'Link added.':'Link added to draft.',{exact:true}).waitFor();ok(kind+' server saved attachment clean',!await unload(p));await field.fill('TEST ONLY local text');await attempt(p,()=>back(p).click(),kind+' attachment plus local text');await discard(p);ok(kind+' discard preserves saved revision/material',entry.working.attachments.length===1&&entry.published.title==='TEST ONLY published');
 }
 await goto(p,'/manage/hub/101');await p.getByLabel('File',{exact:true}).setInputFiles({name:'TEST-ONLY.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF TEST ONLY')});await attempt(p,()=>p.getByLabel(/^Material type/).selectOption('external_link'),'selected file type switch');await keep(p);ok('Keep editing preserves chosen file',await p.getByLabel('File',{exact:true}).evaluate(e=>e.files.length===1));await p.getByLabel(/^Material type/).selectOption('external_link');await discard(p);await p.getByLabel('Link URL',{exact:true}).waitFor();ok('type discard drops local file only',!await unload(p));
 await p.getByLabel('Material name',{exact:true}).fill('TEST ONLY not uploaded');await attempt(p,()=>click(p,'button','Submit for Review'),'material draft before submit');await keep(p);ok('Keep material preserves input',await p.getByLabel('Material name',{exact:true}).inputValue()==='TEST ONLY not uploaded');await click(p,'button','Submit for Review');await discard(p);await p.getByRole('dialog',{name:'Submit resource?',exact:true}).waitFor();ok('discard then submit never stacks confirmations',await p.getByRole('dialog').count()===1);await p.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();ok('discarded material input no longer dirty',await p.getByLabel('Material name',{exact:true}).inputValue()===''&&!await unload(p));
 await goto(p,'/manage/hub/industry/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY Industry create');await attempt(p,()=>back(p).click(),'Industry create');await discard(p);
 // Thread create and editable thread/reply revisions all register the same protection.
 await goto(p,'/innovation-hub/discussions/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY thread');await attempt(p,()=>back(p).click(),'Discussion create');await keep(p);await p.getByLabel('Body',{exact:true}).fill('TEST ONLY body');await click(p,'button','Save Draft');await p.waitForURL('**/discussions/manage/999');await p.getByLabel('Title',{exact:true}).waitFor();ok('Discussion saved clean',!await unload(p));
 for(const type of ['thread','reply'])for(const state of ['draft','rejected']){
  const e=f.state.discussions[0];Object.assign(e,{type,threadId:type==='reply'?302:null,status:state,published:null,working:revision('TEST ONLY editable',state),isAuthor:true});await goto(p,'/innovation-hub/discussions/manage/301');if(state==='rejected')await click(p,'button','Revise rejected content');const field=p.getByLabel('Body',{exact:true});await field.fill('TEST ONLY changed '+type);await attempt(p,()=>type==='reply'?p.getByRole('link',{name:'Back to Thread →',exact:true}).click():back(p).click(),`${type} ${state}`);await keep(p);await click(p,'button','Save Draft');await p.getByText('Discussion saved.',{exact:true}).waitFor();ok(`${type} ${state} save clean`,!await unload(p));
 }
 for(const type of ['thread','reply']){const e=f.state.discussions[0];Object.assign(e,{type,threadId:type==='reply'?302:null,status:'published',working:null,published:revision('TEST ONLY published','approved')});await goto(p,'/innovation-hub/discussions/manage/301');await click(p,'button','Create revision');await p.getByLabel('Body',{exact:true}).fill('TEST ONLY revision edit');await attempt(p,()=>click(p,'link','View Thread →'),type+' published revision');await keep(p);await click(p,'button','Save Draft');await p.getByText('Discussion saved.',{exact:true}).waitFor();ok(type+' revision save clean',!await unload(p));}
 const thread=f.state.discussions[1];Object.assign(thread,{type:'thread',published:revision('TEST ONLY published thread','approved'),working:null,status:'published'});await goto(p,'/innovation-hub/discussions/302');const reply=p.getByRole('region',{name:'Create reply'}).getByLabel('Body',{exact:true});await reply.fill('TEST ONLY inline reply');await attempt(p,()=>back(p).click(),'inline reply');await keep(p);await p.getByRole('region',{name:'Create reply'}).getByRole('button',{name:'Save Draft'}).click();await p.waitForURL('**/discussions/manage/999');ok('inline reply save navigates once',true);
 await goto(p,'/manage/papers/41/edit');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY dirty paper');await attempt(p,()=>click(p,'link','Preview'),'Paper Preview');await discard(p);await p.waitForURL('**/manage/papers/41/preview');ok('Paper Preview destination intact',true);
 await goto(p,'/manage/papers/41/edit');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY paper saved');await click(p,'button','Save Changes');await p.getByText('All changes saved',{exact:true}).waitFor();ok('Paper Save Changes clears existing baseline',!await unload(p));await click(p,'link','Preview');await p.waitForURL('**/manage/papers/41/preview');ok('saved Paper Preview no guard',await dialog(p).count()===0);
 await goto(p,'/manage/papers/41/edit');await click(p,'button','Add External Link');const af=p.getByRole('form',{name:'Add external link'});await af.getByLabel('Display Name',{exact:true}).fill('TEST ONLY attachment');await attempt(p,()=>af.getByRole('button',{name:'Cancel',exact:true}).click(),'Paper attachment Cancel');await keep(p);await af.getByRole('button',{name:'Cancel',exact:true}).click();await discard(p);await af.waitFor({state:'hidden'});ok('Paper attachment discard local only',true);
 await goto(p,'/manage/courses/1');await p.getByLabel('Module to maintain').waitFor();const moduleField=p.locator('textarea[id$="/modules/1-description"]');await moduleField.fill('TEST ONLY module dirty');await attempt(p,()=>p.getByLabel('Module to maintain').selectOption('2'),'Maintenance Module switch');await keep(p);ok('Maintenance Keep module input',await moduleField.inputValue()==='TEST ONLY module dirty');await p.getByLabel('Module to maintain').selectOption('2');await discard(p);await p.locator('textarea[id$="/modules/2-description"]').waitFor();ok('Maintenance Module discard switches',true);
 const courseField=p.locator('textarea[id="/api/courses/1-description"]');await courseField.fill('TEST ONLY course dirty');await p.getByLabel('Module to maintain').selectOption('3');ok('module selection preserves unrelated course edit without prompt',await dialog(p).count()===0&&await courseField.inputValue()==='TEST ONLY course dirty');await click(p,'button','Save course');await p.getByText('Changes saved.',{exact:true}).waitFor();ok('Course save baseline clean',!await unload(p));
 const third=p.locator('textarea[id$="/modules/3-description"]');await third.fill('TEST ONLY independent module edit');course.modules[2].description='TEST ONLY remote edit';course.modules[2].updatedAt=now+':remote';await courseField.fill('TEST ONLY another course save');await Promise.all([p.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/api/courses/1'),click(p,'button','Save course')]);ok('unrelated save preserves module edits',await third.inputValue()==='TEST ONLY independent module edit');ok('unsaved sibling remains dirty after save',await unload(p));await click(p,'button','Save module');await p.getByText('TEST ONLY stale edit token',{exact:true}).waitFor();ok('unrelated refresh never silently upgrades a dirty form edit token',await third.inputValue()==='TEST ONLY independent module edit'&&await unload(p));await p.getByRole('button',{name:'Refresh workspace',exact:true}).click();await discard(p);await third.waitFor();ok('explicit refresh discards local sibling only',!await unload(p));
 await goto(p,'/manage/research-areas/1');await p.getByLabel('Subtopics One per line').fill('TEST ONLY subtopic');await attempt(p,()=>click(p,'link','All assigned areas'),'Research subtopics exit');await keep(p);await click(p,'button','Save area');await p.getByText('Changes saved.',{exact:true}).waitFor();ok('Research successful save clean',!await unload(p));
 await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY navigation');await attempt(p,()=>p.getByRole('navigation',{name:'Management'}).getByRole('link',{name:'Papers',exact:true}).click(),'management tab');await discard(p);await p.waitForURL(u=>u.pathname==='/manage/papers');
 for(const width of [390,820,1440]){await p.setViewportSize({width,height:900});await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY responsive');await attempt(p,()=>back(p).click(),`responsive ${width}`);const box=await dialog(p).boundingBox();ok(`dialog contained ${width}`,box.x>=0&&box.x+box.width<=width&&box.height<900);ok(`no horizontal overflow ${width}`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(output,`dialog-${width}.png`)});await keep(p);await p.getByLabel('Title',{exact:true}).fill('');ok(`reverted beforeunload ${width}`,!await unload(p));}
 // A Navbar search is a programmatic submit rather than a Link; it must also be guarded.
 await p.setViewportSize({width:1440,height:900});await p.getByLabel('Title',{exact:true}).fill('TEST ONLY search exit');await p.locator('form[role=search] input').fill('TEST ONLY query');await attempt(p,()=>p.locator('form[role=search] input').press('Enter'),'Navbar search');await keep(p);
 // Native refresh uses the browser's own beforeunload dialog; cancel retains the input.
 let nativeWarning=false;p.once('dialog',async d=>{nativeWarning=d.type()==='beforeunload';await d.dismiss()});await p.reload({timeout:3000}).catch(()=>{});ok('native refresh beforeunload warning',nativeWarning);ok('native refresh cancel preserves input',await p.getByLabel('Title',{exact:true}).inputValue()==='TEST ONLY search exit');
 // Account menu sign-out is an existing auth button, not a Link. No logout is sent on Keep.
 await p.locator('.account-nav-button').click();const signout=p.getByRole('menuitem',{name:'Sign Out',exact:true});const countBefore=calls.filter(c=>c.path==='/api/auth/logout').length;await attempt(p,()=>signout.click(),'Sign Out');await keep(p);ok('Keep editing does not log out',calls.filter(c=>c.path==='/api/auth/logout').length===countBefore);
 await p.locator('.account-nav-button').click();await signout.click();await discard(p);await p.waitForURL(u=>u.pathname==='/');ok('Discard signs out once',calls.filter(c=>c.path==='/api/auth/logout').length===countBefore+1);f.state.role='admin';await goto(p,'/manage/hub/new');await p.getByLabel('Title',{exact:true}).waitFor();
 // Late accepted save after an auth switch must not navigate or repopulate the next account's form.
 f.state.saveDelay=700;await p.getByLabel('Title',{exact:true}).fill('TEST ONLY old account save');await Promise.all([p.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/hub/entries'),click(p,'button','Save Draft')]);
 f.state.id=903;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.getByLabel('Title',{exact:true}).waitFor();await p.waitForTimeout(950);ok('late save never navigates next account',new URL(p.url()).pathname==='/manage/hub/new');ok('late save cannot repopulate next account',await p.getByLabel('Title',{exact:true}).inputValue()==='');f.state.saveDelay=0;
 // Auth refresh switches the keyed editor subtree, never transfers local input or deferred exits.
 await p.getByLabel('Title',{exact:true}).fill('TEST ONLY account A private');f.state.id=902;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.waitForFunction(()=>document.querySelector('input')?.value!=='TEST ONLY account A private');await p.waitForTimeout(250);ok('account switch clears old local form',await p.getByLabel('Title',{exact:true}).inputValue()==='');ok('account switch clears dirty listener',!await unload(p));
 ok('no automatic learning mutations',calls.filter(c=>!['GET','HEAD'].includes(c.method)&&c.path.startsWith('/api/learning/')).length===0);ok('no unhandled browser errors',errors.length===0);ok('all requested APIs mocked',unknown.length===0);
 ok('no React or application console errors',warnings.every(w=>/^Failed to load resource: the server responded with a status of (503|409)/.test(w.text)));
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,errors,unknown,warnings,calls},null,2));console.log(JSON.stringify({passed:checks.length,errors,unknown,output},null,2));await f.context.close();
}
run().catch(async e=>{console.error(e);await debugPage?.screenshot({path:path.join(output,'failure.png')});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({checks,errors,unknown,warnings,calls,error:String(e)},null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();await server?.close();});
