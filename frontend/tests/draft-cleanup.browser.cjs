// TEST ONLY. Every API is mocked in browser memory. Never starts Flask or touches a database.
// Run from repository root with Playwright available via NODE_PATH.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.NAV_TEST_ORIGIN || 'http://127.0.0.1:5178';
const output = process.env.NAV_TEST_OUTPUT || 'tmp/draft-cleanup/browser';
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
      } else if(m==='DELETE') {state.discussions=state.discussions.filter(x=>x.id!==Number(suffix.split('/')[2]));body={deleted:true,cleanupPending:false};}
      else if(m==='POST'&&suffix.endsWith('/discard-revision')) {const entry=state.discussions.find(x=>x.id===Number(suffix.split('/')[2]));entry.working=null;entry.status='published';entry.version++;body={entry};}
      else if(m==='POST'&&suffix.endsWith('/withdraw')) {const entry=state.discussions.find(x=>x.id===Number(suffix.split('/')[2]));entry.working.state='draft';entry.status=entry.published?'published':'draft';entry.version++;body={entry};}
      else if (m==='PATCH') {const entry=state.discussions.find(x=>x.id===Number(suffix.split('/')[2]));Object.assign(entry.working,data);entry.version++;body={entry};}
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
      if(m==='DELETE') {state[kind]=state[kind].filter(x=>x.id!==id);body={deleted:true,cleanupPending:false};}
      else if(m==='POST'&&suffix.endsWith('/discard-revision')) {entry.working=null;entry.status='published';entry.version++;body={entry};}
      else if(m==='POST'&&suffix.endsWith('/withdraw')) {entry.working.state='draft';entry.status=entry.published?'published':'draft';entry.version++;body={entry};}
      else if (m==='POST' && !suffix) {const entry={id:999,kind,status:'draft',ownerId:901,submittedById:901,version:1,published:null,working:{...revision(data.title,'draft'),...data}};state[kind].push(entry);body={entry};}
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
const navPath=kind=>kind==='faculty'?'/manage/hub':kind==='industry'?'/manage/hub/industry':'/manage/hub/discussions';
const managePath=(kind,id)=>kind==='faculty'?'/manage/hub/'+id:kind==='industry'?'/manage/hub/industry/'+id:'/innovation-hub/discussions/manage/'+id;
const requestRoot=kind=>kind==='faculty'?'/api/hub/entries':kind==='industry'?'/api/hub/industry/entries':'/api/hub/discussions/entries';
async function unload(p){return p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})}
async function setup(kind,role){const f=await fixture(role||(kind==='faculty'||kind==='industry'?'teacher':'admin'));const key=kind==='faculty'||kind==='industry'?kind:'discussions';for(const e of f.state[key]){e.status='draft';e.working.state='draft';e.isAuthor=true;if(kind==='reply'){e.type='reply';e.threadId=302;}}return {...f,key};}
const confirm=(p,name)=>p.getByRole('dialog',{name,exact:true});
async function openCleanup(p,label,title){await click(p,'button',label);await confirm(p,title).waitFor();ok(label+' uses one specific confirmation',await p.getByRole('dialog').count()===1&&!await p.getByRole('heading',{name:'Discard unsaved changes?',exact:true}).count());}
async function run(){
 await fs.mkdir(output,{recursive:true});const seed=JSON.parse(await fs.readFile('project/migrations/data/r4a_course.json','utf8'));course={...seed.course,id:1,moduleCount:12,totalHours:36,modules:seed.modules.map((m,i)=>({...m,id:i+1}))};
 const {createServer}=await import('../node_modules/vite/dist/node/index.js');server=await createServer({root:path.resolve('frontend'),server:{host:'127.0.0.1',port:5178,strictPort:true}});await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const kind of ['faculty','industry','thread','reply']){
  const f=await setup(kind),p=f.page;debugPage=p;await goto(p,navPath(kind)+'?scope=mine&page=2');const link=p.locator(kind==='thread'||kind==='reply'?'.faculty-list h2 a':'.faculty-list h3 a').first();await link.click();await p.reload();const field=p.getByLabel(kind==='reply'?'Body':'Title',{exact:true});await field.fill('TEST ONLY unsaved input');const url=p.url();
  await openCleanup(p,'Delete draft','Delete this draft?');await p.keyboard.press('Escape');await confirm(p,'Delete this draft?').waitFor({state:'hidden'});ok(kind+' cancel preserves local dirty text',await field.inputValue()==='TEST ONLY unsaved input'&&await unload(p));ok(kind+' restores Delete draft focus',await p.getByRole('button',{name:'Delete draft',exact:true}).evaluate(e=>e===document.activeElement));
  f.state.failSave=true;await openCleanup(p,'Delete draft','Delete this draft?');await confirm(p,'Delete this draft?').getByRole('button',{name:'Delete draft',exact:true}).click();await confirm(p,'Delete this draft?').getByText('TEST ONLY save failure',{exact:true}).waitFor();ok(kind+' failure stays usable and preserves URL',p.url()===url);await confirm(p,'Delete this draft?').getByRole('button',{name:'Cancel',exact:true}).click();ok(kind+' failure retains inputs',await field.inputValue()==='TEST ONLY unsaved input');f.state.failSave=false;
  await openCleanup(p,'Delete draft','Delete this draft?');await confirm(p,'Delete this draft?').getByRole('button',{name:'Delete draft',exact:true}).click();await p.waitForURL(u=>u.pathname===navPath(kind)&&u.searchParams.get('scope')==='mine'&&u.searchParams.get('page')==='2');await p.locator('.faculty-list').waitFor();ok(kind+' deletion returns authoritative page-2 origin',true);ok(kind+' deletion clears dirty state',!await unload(p));
  const entry=f.state[f.key][0];entry.status='rejected';entry.working.state='rejected';await goto(p,managePath(kind,entry.id));await p.getByRole('button',{name:'Delete draft',exact:true}).waitFor();ok(kind+' rejected draft delete available',true);
  entry.status='pending';entry.working.state='pending';await p.reload();await p.getByRole('button',{name:'Withdraw to Draft',exact:true}).waitFor();ok(kind+' pending delete unavailable',await p.getByRole('button',{name:'Delete draft',exact:true}).count()===0);await click(p,'button','Withdraw to Draft');await p.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await p.getByRole('button',{name:'Delete draft',exact:true}).waitFor();ok(kind+' withdraw enables cleanup',true);
  entry.status='published';entry.published={...revision('TEST ONLY unchanged public','approved')};entry.working=null;await p.reload();await p.getByRole('heading',{name:kind==='faculty'?'Manage Faculty Resource':kind==='industry'?'Manage Industry Update':kind==='thread'?'Manage Thread':'Manage Reply',exact:true}).waitFor();ok(kind+' published cannot Delete draft',await p.getByRole('button',{name:'Delete draft',exact:true}).count()===0);ok(kind+' existing admin published-delete boundary preserved',await p.getByRole('button',{name:'Delete permanently',exact:true}).count()===(f.state.role==='admin'?1:0));
  entry.working={...revision('TEST ONLY revision','draft'),number:2};await p.reload();const dirtyField=p.getByLabel(kind==='reply'?'Body':'Title',{exact:true});await dirtyField.fill('TEST ONLY local revision');await openCleanup(p,'Discard revision','Discard this revision?');const d=confirm(p,'Discard this revision?');await d.getByRole('button',{name:'Keep revision',exact:true}).waitFor();ok(kind+' Keep revision has initial focus',await d.getByRole('button',{name:'Keep revision',exact:true}).evaluate(e=>e===document.activeElement));await d.getByRole('button',{name:'Keep revision',exact:true}).click();ok(kind+' Keep revision retains dirty inputs',await dirtyField.inputValue()==='TEST ONLY local revision');
  f.state.failSave=true;await openCleanup(p,'Discard revision','Discard this revision?');await d.getByRole('button',{name:'Discard revision',exact:true}).click();await d.getByText('TEST ONLY save failure',{exact:true}).waitFor();await d.getByRole('button',{name:'Keep revision',exact:true}).click();ok(kind+' failed revision discard keeps local input',await dirtyField.inputValue()==='TEST ONLY local revision');f.state.failSave=false;
  await openCleanup(p,'Discard revision','Discard this revision?');await d.getByRole('button',{name:'Discard revision',exact:true}).click();await p.getByText('Revision discarded. The published version is unchanged.',{exact:true}).waitFor();ok(kind+' published survives revision discard',entry.published.title==='TEST ONLY unchanged public'&&entry.working===null);ok(kind+' discard cleans dirty registry',!await unload(p));ok(kind+' discard remains on existing manager',p.url()===managePath(kind,entry.id).replace(/^/,base));
  entry.working={...revision('TEST ONLY pending revision','pending'),number:3};await p.reload();await p.getByRole('button',{name:'Withdraw to Draft',exact:true}).waitFor();ok(kind+' pending revision discard unavailable',await p.getByRole('button',{name:'Discard revision',exact:true}).count()===0);await click(p,'button','Withdraw to Draft');await p.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await p.getByRole('button',{name:'Discard revision',exact:true}).waitFor();ok(kind+' withdrawn revision discard available',true);
  await f.context.close();
 }
 for(const kind of ['thread','reply']){const f=await setup(kind,'student'),p=f.page;debugPage=p;const entry=f.state.discussions[0];await goto(p,managePath(kind,entry.id));await p.getByLabel(kind==='reply'?'Body':'Title',{exact:true}).fill('TEST ONLY learner local');await openCleanup(p,'Delete draft','Delete this draft?');await confirm(p,'Delete this draft?').getByRole('button',{name:'Delete draft',exact:true}).click();await p.waitForURL(u=>u.pathname==='/innovation-hub'&&u.searchParams.get('scope')==='mine');ok(kind+' learner direct access deletion uses stable semantic fallback',true);const other=f.state.discussions[0];other.status='published';other.published=revision('TEST ONLY learner published','approved');other.working=revision('TEST ONLY revision','draft');await goto(p,managePath(kind,other.id));await p.getByRole('button',{name:'Discard revision',exact:true}).waitFor();ok(kind+' learner cannot delete Published entry',await p.getByRole('button',{name:'Delete draft',exact:true}).count()===0&&await p.getByRole('button',{name:'Delete permanently',exact:true}).count()===0);await openCleanup(p,'Discard revision','Discard this revision?');await confirm(p,'Discard this revision?').getByRole('button',{name:'Discard revision',exact:true}).click();await p.getByText('Revision discarded. The published version is unchanged.',{exact:true}).waitFor();ok(kind+' learner discards only own working revision',other.published.title==='TEST ONLY learner published'&&other.working===null);await f.context.close();}
 const reports=await setup('thread'),rp=reports.page;debugPage=rp;for(const e of reports.state.discussions){e.status='published';e.published=revision('TEST ONLY reported published','approved')};await goto(rp,'/manage/hub/discussions?scope=reports&status=resolved&page=2');await rp.getByRole('link',{name:'Review target content →',exact:true}).first().click();await openCleanup(rp,'Discard revision','Discard this revision?');await confirm(rp,'Discard this revision?').getByRole('button',{name:'Discard revision',exact:true}).click();await rp.getByText('Revision discarded. The published version is unchanged.',{exact:true}).waitFor();await rp.locator('.management-return').first().click();await rp.waitForURL(u=>u.searchParams.get('scope')==='reports'&&u.searchParams.get('status')==='resolved'&&u.searchParams.get('page')==='2');ok('revision discard preserves report status/page return context',true);await reports.context.close();
 const f=await setup('faculty'),p=f.page;debugPage=p;for(const width of [390,820,1440]){await p.setViewportSize({width,height:900});await goto(p,'/manage/hub/101');await p.getByLabel('Title',{exact:true}).fill('TEST ONLY responsive local');await openCleanup(p,'Delete draft','Delete this draft?');const d=confirm(p,'Delete this draft?');await p.keyboard.press('Tab');ok('focus stays modal '+width,await d.evaluate(e=>e.contains(document.activeElement)));const b=await d.boundingBox();ok('dialog fits viewport '+width,b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<=900);ok('no overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(output,'cleanup-'+width+'.png')});await d.getByRole('button',{name:'Cancel',exact:true}).click();}
 const mutationBefore=calls.filter(c=>c.method==='DELETE').length;f.state.saveDelay=800;await openCleanup(p,'Delete draft','Delete this draft?');await Promise.all([p.waitForRequest(r=>r.method()==='DELETE'),confirm(p,'Delete this draft?').getByRole('button',{name:'Delete draft',exact:true}).click()]);f.state.id=902;f.state.forbidden=true;await p.evaluate(()=>window.dispatchEvent(new Event('focus')));await p.getByRole('heading',{name:'Access denied',exact:true}).waitFor();await p.waitForTimeout(950);ok('late deletion cannot navigate next account',new URL(p.url()).pathname==='/manage/hub/101');ok('delete mutation not replayed on account switch',calls.filter(c=>c.method==='DELETE').length===mutationBefore+1);
 ok('no learning writes',calls.filter(c=>!['GET','HEAD'].includes(c.method)&&c.path.startsWith('/api/learning/')).length===0);ok('no page errors',errors.length===0);ok('all APIs isolated mocks',unknown.length===0);await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks,calls,errors,unknown,warnings},null,2));console.log(JSON.stringify({passed:checks.length,errors,unknown,output}));await f.context.close();
}
run().catch(async e=>{console.error(e);await debugPage?.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({checks,calls,errors,unknown,error:String(e)},null,2));process.exitCode=1}).finally(async()=>{await browser?.close();await server?.close()});
