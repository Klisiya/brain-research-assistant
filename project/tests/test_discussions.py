"""R8A3 TEST ONLY: isolated text fixtures, moderation/privacy/cleanup regression."""
import unittest
from io import BytesIO
from sqlalchemy import event, select, text, func
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
from app import app, db, User, HubEntry, HubRevision, HubModerationEvent, HubDiscussion, HubReport, HubReportEvent, HubDeletionAudit, HubAttachment, FileAsset

BASE='/api/hub/discussions'


class DiscussionTests(unittest.TestCase):
    tearDown=fixtures.AttachmentTests.tearDown
    tearDownClass=fixtures.AttachmentTests.tearDownClass
    login=fixtures.AttachmentTests.login

    def setUp(self):
        fixtures.AttachmentTests.setUp(self)
        with app.app_context():
            user=User(id=5,username='TEST ONLY other learner',email='other-learner@example.test',role='student',auth_version=1)
            user.set_password('TEST-ONLY-other-password');db.session.add(user);db.session.commit()

    def create(self,uid=4,parent=None,**extra):
        self.login(uid)
        response=self.client.post(BASE+(f'/entries/{parent}/replies' if parent else '/entries'),json={
            **({} if parent else {'title':'TEST ONLY ThreadAlpha'}),'body':'TEST ONLY neutral text',**extra})
        self.assertEqual(response.status_code,201,response.json)
        return response.json['entry']

    def action(self,entry,action,uid=4,**extra):
        self.login(uid)
        return self.client.post(f"{BASE}/entries/{entry['id']}/{action}",json={'expectedVersion':entry['version'],**extra})

    def publish(self,entry,uid=4):
        pending=self.action(entry,'submit',uid)
        self.assertEqual(pending.status_code,200,pending.json)
        approved=self.action(pending.json['entry'],'approve',3)
        self.assertEqual(approved.status_code,200,approved.json)
        return approved.json['entry']

    def get(self,entry,suffix='',uid=5):
        self.login(uid)
        return self.client.get(f"{BASE}/entries/{entry['id']}{suffix}")

    def edit(self,entry,uid=4,**extra):
        self.login(uid)
        return self.client.patch(f"{BASE}/entries/{entry['id']}",json={'expectedVersion':entry['version'],
            **({'title':'TEST ONLY ThreadBeta'} if entry['type']=='thread' else {}),'body':'TEST ONLY revised text',**extra})

    def report(self,entry,uid=5,**extra):
        self.login(uid)
        return self.client.post(f"{BASE}/entries/{entry['id']}/reports",json={'reason':'TEST ONLY reason','detail':'TEST ONLY private detail',**extra})

    def delete(self,entry,uid=4,**extra):
        self.login(uid)
        return self.client.delete(f"{BASE}/entries/{entry['id']}",json={'expectedVersion':entry['version'],'confirmation':'DELETE',**extra})

    def test_learner_and_teacher_threads_require_review_and_public_identity_is_safe(self):
        for uid in [4,1]:
            entry=self.create(uid)
            self.assertEqual(self.get(entry).status_code,404)
            pending=self.action(entry,'submit',uid).json['entry']
            self.assertEqual(self.get(entry).status_code,404)
            self.assertEqual(self.action(pending,'approve',uid).status_code,403)
            live=self.action(pending,'approve',3).json['entry']
            public=self.get(live).json['entry']
            self.assertEqual(set(public),{'id','type','threadId','canManage','author','published'})
            self.assertIsNotNone(public['published']['publishedAt'])
            self.assertNotIn('working',public)
            self.assertNotIn('fixture-',str(public.get('email','')))
            with app.app_context():
                self.assertEqual(db.session.get(HubRevision,db.session.get(HubEntry,entry['id']).published_revision_id).reviewed_by_id,3)

    def test_rejected_thread_reopens_edits_and_resubmits(self):
        pending=self.action(self.create(),'submit').json['entry']
        rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY correct text').json['entry']
        self.assertIsNone(rejected['working']['publishedAt'])
        self.assertEqual(self.get(rejected).status_code,404)
        self.assertEqual(self.edit(rejected).status_code,409)
        draft=self.action(rejected,'draft').json['entry']
        edited=self.edit(draft).json['entry']
        live=self.publish(edited)
        self.assertEqual(self.get(live).json['entry']['published']['title'],'TEST ONLY ThreadBeta')

    def test_reply_pending_rejected_revision_lifecycle_and_no_nested_replies(self):
        root=self.publish(self.create())
        reply=self.create(parent=root['id'])
        self.assertEqual(reply['type'],'reply')
        self.assertEqual(self.get(reply).status_code,404)
        pending=self.action(reply,'submit').json['entry']
        self.assertEqual(self.get(root,'/replies').json['entries'],[])
        rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY revise reply').json['entry']
        self.assertEqual(self.get(reply).status_code,404)
        draft=self.action(rejected,'draft').json['entry'];edited=self.edit(draft).json['entry']
        published=self.publish(edited)
        self.assertEqual([row['id'] for row in self.get(root,'/replies').json['entries']],[reply['id']])
        self.assertNotIn('title',self.get(published).json['entry']['published'])
        self.login(4)
        self.assertEqual(self.client.post(f"{BASE}/entries/{reply['id']}/replies",json={'body':'TEST ONLY nested'}).status_code,400)

    def test_published_thread_and_reply_revisions_preserve_old_until_approval(self):
        root=self.publish(self.create())
        reply=self.publish(self.create(parent=root['id']))
        for original in [root,reply]:
            self.assertEqual(self.edit(original).status_code,409)
            draft=self.action(original,'draft').json['entry']
            edited=self.edit(draft).json['entry']
            pending=self.action(edited,'submit').json['entry']
            self.assertEqual(self.get(pending).json['entry']['published']['body'],'TEST ONLY neutral text')
            self.assertEqual(self.edit(pending).status_code,409)
            rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY rejected revision').json['entry']
            self.assertEqual(self.get(rejected).json['entry']['published']['body'],'TEST ONLY neutral text')
            draft=self.action(rejected,'draft').json['entry'];live=self.publish(draft)
            self.assertEqual(self.get(live).json['entry']['published']['body'],'TEST ONLY revised text')

    def test_direct_urls_and_idor_for_threads_and_replies_all_nonpublic_states(self):
        root=self.publish(self.create())
        for entry in [self.create(),self.create(parent=root['id'])]:
            pending=self.action(entry,'submit').json['entry']
            for uid in [1,2,5,None]:
                self.assertEqual(self.get(pending,uid=uid).status_code,401 if uid is None else 404)
                self.assertEqual(self.get(pending,'/manage',uid).status_code,401 if uid is None else 404)
                self.assertEqual(self.edit(pending,uid).status_code,401 if uid is None else 404)
                self.assertEqual(self.delete(pending,uid).status_code,401 if uid is None else 404)
            rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY private rejection').json['entry']
            self.assertEqual(self.get(rejected).status_code,404)
            self.assertEqual(self.get(rejected,'/manage',4).status_code,200)

    def test_forged_fields_illegal_transitions_stale_versions_and_admin_own_publish(self):
        entry=self.create()
        for extra in [{'ownerId':3},{'status':'published'},{'reviewedById':3},{'threadId':1}]:
            self.login(4)
            self.assertEqual(self.client.post(BASE+'/entries',json={'title':'TEST ONLY forged','body':'TEST ONLY',**extra}).status_code,400)
        self.assertEqual(self.action(entry,'approve',3).status_code,409)
        self.assertEqual(self.action(entry,'publish',4).status_code,403)
        self.assertEqual(self.action(entry,'publish',3).status_code,403)
        pending=self.action(entry,'submit').json['entry']
        self.assertEqual(self.action(entry,'withdraw').status_code,409)
        self.assertEqual(self.action(pending,'approve',3,reviewerId=4).status_code,400)
        draft=self.action(pending,'withdraw').json['entry']
        self.assertEqual(draft['working']['state'],'draft')
        own=self.create(uid=3)
        live=self.action(own,'publish',3)
        self.assertEqual(live.status_code,200,live.json)
        self.assertEqual(self.get(own).status_code,200)

    def test_search_only_current_published_thread_not_reply_report_or_private_revision(self):
        root=self.create(title='TEST ONLY SearchAlpha',body='TEST ONLY RootToken')
        self.login(5)
        self.assertEqual(self.client.get('/api/search?q=RootToken&type=hub').json['total'],0)
        root=self.publish(root)
        reply=self.publish(self.create(parent=root['id'],body='TEST ONLY ReplyUniqueToken'))
        self.report(reply,detail='TEST ONLY ReportPrivateToken')
        draft=self.action(root,'draft').json['entry'];draft=self.edit(draft,title='TEST ONLY SearchBeta',body='TEST ONLY PendingUniqueToken').json['entry']
        pending=self.action(draft,'submit').json['entry']
        self.login(5)
        for term in ['ReplyUniqueToken','ReportPrivateToken','PendingUniqueToken','SearchBeta']:
            self.assertEqual(self.client.get('/api/search',query_string={'q':term,'type':'hub'}).json['total'],0,term)
        result=self.client.get('/api/search?q=RootToken&type=hub').json
        self.assertEqual(result['total'],1)
        self.assertEqual(result['items'][0]['route'],f"/innovation-hub/discussions/{root['id']}")
        approved=self.action(pending,'approve',3).json['entry']
        self.login(5)
        self.assertEqual(self.client.get('/api/search?q=PendingUniqueToken&type=hub').json['total'],1)
        self.assertEqual(self.client.get('/api/search?q=RootToken&type=hub').json['total'],0)
        self.login(None)
        self.assertEqual(self.client.get('/api/search?q=PendingUniqueToken&type=hub').status_code,401)
        self.assertEqual(self.client.get('/api/search?q=PendingUniqueToken').json['total'],0)
        self.assertEqual(approved['published']['title'],'TEST ONLY SearchBeta')

    def test_reports_thread_reply_private_queues_and_manual_resolution(self):
        root=self.publish(self.create());reply=self.publish(self.create(parent=root['id']))
        for index,entry in enumerate([root,reply]):
            response=self.report(entry)
            self.assertEqual(response.status_code,201,response.json)
            report=response.json['report']
            self.assertEqual(set(report),{'id','status'})
            self.assertEqual(self.get(entry).status_code,200)
            for uid in [4,5,1,None]:
                self.login(uid)
                for path in ['/reports',f"/reports/{report['id']}"]:
                    self.assertEqual(self.client.get(BASE+path).status_code,401 if uid is None else 403)
                self.assertEqual(self.client.post(f"{BASE}/reports/{report['id']}/resolve",json={'expectedVersion':1}).status_code,401 if uid is None else 403)
            self.login(3)
            queue=self.client.get(BASE+'/reports').json['entries']
            actual=next(row for row in queue if row['id']==report['id'])
            self.assertEqual(actual['targetId'],entry['id'])
            action='resolve' if index==0 else 'dismiss'
            result=self.client.post(f"{BASE}/reports/{report['id']}/{action}",json={'expectedVersion':1})
            self.assertEqual(result.status_code,200,result.json)
            self.assertIsNotNone(result.json['report']['resolvedAt'])
            self.assertEqual(result.json['report']['resolvedBy'],3)
            self.assertEqual(self.client.post(f"{BASE}/reports/{report['id']}/{action}",json={'expectedVersion':1}).status_code,409)
            history=self.client.get(f"{BASE}/reports/{report['id']}").json['events']
            self.assertEqual([row['action'] for row in history],['reported','resolved' if index==0 else 'dismissed'])
            self.assertEqual(self.get(entry).status_code,200)

    def test_report_target_tampering_drafts_and_attachment_routes_cannot_bypass(self):
        draft=self.create();self.assertEqual(self.report(draft).status_code,404)
        live=self.publish(draft)
        self.assertEqual(self.report(live,targetId=999,targetType='thread').status_code,400)
        self.assertEqual(self.report(live,reporterId=3).status_code,400)
        self.assertEqual(self.report(live,reason='').status_code,400)
        self.assertEqual(self.report(live,detail={'html':'TEST ONLY'}).status_code,400)
        self.login(1)
        foreign=self.client.post('/api/hub/entries',json={'title':'TEST ONLY faculty'}).json['entry']
        self.assertEqual(self.report(foreign).status_code,404)
        self.login(4)
        for path in [f"/entries/{live['id']}/attachments",f"/entries/{live['id']}/review"]:
            self.assertEqual(self.client.post(BASE+path,json={}).status_code,404)
        for namespace in ['/api/hub/entries','/api/hub/industry/entries']:
            self.assertEqual(self.client.get(f"{namespace}/{live['id']}").status_code,404)
            self.assertEqual(self.client.get(f"{namespace}/{live['id']}/revisions/1/attachments/1/download").status_code,404)

    def test_archive_parent_hides_replies_and_prevents_new_or_approved_activity(self):
        root=self.publish(self.create());reply=self.publish(self.create(parent=root['id']))
        pending=self.action(self.create(parent=root['id']),'submit').json['entry']
        pending_rejection=self.action(self.create(parent=root['id']),'submit').json['entry']
        self.assertEqual(self.action(root,'archive',4).status_code,403)
        root=self.action(root,'archive',3).json['entry']
        self.assertEqual(self.get(root).status_code,404);self.assertEqual(self.get(reply).status_code,404)
        self.assertEqual(self.action(pending,'approve',3).status_code,409)
        rejected=self.action(pending_rejection,'reject',3,reviewNote='TEST ONLY closed parent').json['entry']
        self.assertEqual(rejected['working']['state'],'rejected')
        self.assertEqual(self.delete(rejected).status_code,200)
        self.login(4)
        self.assertEqual(self.client.post(f"{BASE}/entries/{root['id']}/replies",json={'body':'TEST ONLY blocked'}).status_code,404)
        draft=self.action(pending,'withdraw').json['entry']
        self.assertEqual(self.delete(draft).status_code,200)
        self.assertEqual(self.report(reply).status_code,404)

    def test_safe_delete_draft_rejected_pending_and_published_author_rules(self):
        draft=self.create()
        self.assertEqual(self.delete(draft,confirmation='delete').status_code,400)
        self.assertEqual(self.delete(draft).status_code,200)
        pending=self.action(self.create(),'submit').json['entry']
        self.assertEqual(self.delete(pending).status_code,409)
        rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY reject').json['entry']
        self.assertEqual(self.delete(rejected).status_code,200)
        root=self.publish(self.create());reply=self.publish(self.create(parent=root['id']))
        for row in [root,reply]:
            self.assertEqual(self.delete(row).status_code,403)
            working=self.action(row,'draft').json['entry'];self.assertEqual(self.delete(working).status_code,403)

    def test_admin_delete_thread_cleans_graph_and_retains_report_tombstone_audit(self):
        root=self.publish(self.create());reply=self.publish(self.create(parent=root['id']))
        pending=self.action(self.create(parent=root['id']),'submit').json['entry']
        report=self.report(reply).json['report']
        survivor=self.publish(self.create(uid=1,title='TEST ONLY Survivor'),uid=1)
        self.assertEqual(self.delete(root,3).status_code,200)
        for row in [root,reply,pending]:
            self.assertEqual(self.get(row).status_code,404)
            self.assertEqual(self.get(row,'/manage',3).status_code,404)
        self.assertEqual(self.get(survivor).status_code,200)
        with app.app_context():
            ids=[root['id'],reply['id'],pending['id']]
            self.assertEqual(db.session.query(HubDiscussion).filter(HubDiscussion.entry_id.in_(ids)).count(),0)
            self.assertEqual(db.session.query(HubRevision).filter(HubRevision.entry_id.in_(ids)).count(),0)
            self.assertEqual(db.session.query(HubModerationEvent).filter(HubModerationEvent.entry_id.in_(ids)).count(),0)
            self.assertEqual(db.session.query(HubDeletionAudit).filter(HubDeletionAudit.original_entry_id.in_(ids)).count(),3)
            self.assertEqual(db.session.execute(text('PRAGMA foreign_key_check')).all(),[])
        self.login(3)
        actual=self.client.get(f"{BASE}/reports/{report['id']}").json
        self.assertEqual(actual['report']['targetState'],'deleted');self.assertIsNone(actual['report']['targetId'])
        self.assertEqual(actual['report']['status'],'open')
        self.assertEqual(actual['events'][-1]['action'],'target_deleted')
        self.assertEqual(self.client.post(f"{BASE}/reports/{report['id']}/resolve",json={'expectedVersion':1}).status_code,409)
        self.assertEqual(self.client.post(f"{BASE}/reports/{report['id']}/resolve",json={'expectedVersion':actual['report']['version']}).status_code,200)

    def test_admin_delete_reply_preserves_thread_and_other_reply(self):
        root=self.publish(self.create());first=self.publish(self.create(parent=root['id']));second=self.publish(self.create(parent=root['id']))
        self.assertEqual(self.delete(first,3).status_code,200)
        self.assertEqual([row['id'] for row in self.get(root,'/replies').json['entries']],[second['id']])

    def test_audit_failures_rollback_approval_report_and_delete(self):
        root=self.create();pending=self.action(root,'submit').json['entry']
        def fail(*_):raise SQLAlchemyError('TEST ONLY audit failure')
        event.listen(HubModerationEvent,'before_insert',fail)
        try:self.assertEqual(self.action(pending,'approve',3).status_code,503)
        finally:event.remove(HubModerationEvent,'before_insert',fail)
        self.assertEqual(self.get(root).status_code,404)
        live=self.action(pending,'approve',3).json['entry']
        event.listen(HubReportEvent,'before_insert',fail)
        try:self.assertEqual(self.report(live).status_code,503)
        finally:event.remove(HubReportEvent,'before_insert',fail)
        with app.app_context():self.assertEqual(HubReport.query.count(),0)
        event.listen(HubDeletionAudit,'before_insert',fail)
        try:self.assertEqual(self.delete(live,3).status_code,503)
        finally:event.remove(HubDeletionAudit,'before_insert',fail)
        self.assertEqual(self.get(live).status_code,200)

    def test_lists_pagination_history_session_csrf_xss_and_no_learning_writes(self):
        self.login(4)
        self.assertEqual(self.client.get(BASE+'/entries').json['entries'],[])
        self.assertEqual(self.client.get(BASE+'/entries?scope=mine').json['entries'],[])
        for scope in ['all','review']:
            self.assertEqual(self.client.get(BASE+'/entries?scope='+scope).status_code,403)
        entry=self.create(title='TEST ONLY <script>bad()</script>',body='<img src=x onerror=bad()> TEST ONLY')
        live=self.publish(entry)
        self.assertEqual(self.get(live).json['entry']['published']['body'],'<img src=x onerror=bad()> TEST ONLY')
        self.assertEqual(self.get(live,'/history',4).status_code,403)
        history=self.get(live,'/history',3).json['entries']
        self.assertEqual([row['action'] for row in reversed(history)],['created','submitted','approved'])
        self.login(4)
        self.assertEqual(self.client.get(BASE+'/entries?page=0').status_code,400)
        self.assertEqual(self.client.get(BASE+'/entries?scope=mine&scope=published').status_code,400)
        self.assertEqual(self.client.get(BASE+'/entries/9999999999999999999999999').status_code,404)
        self.assertEqual(self.client.post(BASE+'/entries',json={'title':'TEST ONLY','body':'x'*70000}).status_code,413)
        raw=app.test_client()
        self.assertEqual(raw.post(BASE+'/entries',json={}).status_code,403)
        with app.app_context():
            tables=[table for table in db.metadata.sorted_tables if table.name.startswith('learning_')]
            before=[db.session.scalar(select(func.count()).select_from(table)) for table in tables]
        for _ in range(3):
            self.get(live);self.get(live,'/replies');self.client.get(BASE+'/entries');self.client.get('/api/search?q=TEST&type=hub')
        with app.app_context():
            self.assertEqual(before,[db.session.scalar(select(func.count()).select_from(table)) for table in tables])
            user=db.session.get(User,4);user.is_active=False;db.session.commit()
        self.assertEqual(self.get(live,uid=4).status_code,401)

    def test_pagination_threads_replies_and_reports_keep_all_items_accessible(self):
        threads=[]
        for index in range(13):
            own=self.create(uid=3,title='TEST ONLY Page '+str(index))
            threads.append(self.action(own,'publish',3).json['entry'])
        self.login(4)
        first=self.client.get(BASE+'/entries').json;second=self.client.get(BASE+'/entries?page=2').json
        self.assertEqual((len(first['entries']),len(second['entries']),first['totalPages']),(12,1,2))
        self.assertEqual(len({row['id'] for row in first['entries']+second['entries']}),13)
        for index in range(13):
            reply=self.create(uid=3,parent=threads[0]['id'],body='TEST ONLY Page reply '+str(index))
            self.action(reply,'publish',3)
            self.report(threads[0])
        self.login(4)
        self.assertEqual(self.client.get(f"{BASE}/entries/{threads[0]['id']}/replies?page=2").json['total'],13)
        self.assertEqual(len(self.client.get(f"{BASE}/entries/{threads[0]['id']}/replies?page=2").json['entries']),1)
        self.login(3)
        self.assertEqual(len(self.client.get(BASE+'/reports?page=2').json['entries']),1)

    def test_delete_preserves_shared_assets_and_vetoes_foreign_content_graph(self):
        draft=self.create()
        self.login(1)
        faculty=self.client.post('/api/hub/entries',json={'title':'TEST ONLY asset owner'}).json['entry']
        upload=self.client.post(f"/api/hub/entries/{faculty['id']}/attachments",content_type='multipart/form-data',data={
            'expectedVersion':str(faculty['version']),'displayName':'TEST ONLY PDF','attachmentType':'pdf',
            'file':(BytesIO(fixtures.pdf()),'TEST-ONLY.pdf','application/pdf')})
        self.assertEqual(upload.status_code,201,upload.json)
        with app.app_context():
            attachment=db.session.get(HubAttachment,upload.json['entry']['working']['attachments'][0]['id'])
            asset_id,key=attachment.asset_id,attachment.asset.storage_key
            db.session.add(HubAttachment(revision_id=db.session.get(HubEntry,draft['id']).working_revision_id,asset_id=asset_id,display_name='TEST ONLY future relation'))
            db.session.commit()
        self.assertEqual(self.delete(draft).status_code,200)
        with app.app_context():
            self.assertIsNotNone(db.session.get(FileAsset,asset_id));self.assertTrue(self.backend.exists(key))
        live=self.publish(self.create())
        with app.app_context():
            db.session.add(HubDiscussion(entry_id=faculty['id'],thread_id=live['id']));db.session.commit()
        self.assertEqual(self.delete(live,3).status_code,409)
        self.assertEqual(self.get(live).status_code,200)
        self.login(1)
        self.assertEqual(self.client.get(f"/api/hub/entries/{faculty['id']}/manage").status_code,200)

    def test_anonymous_create_and_disabled_admin_approval_are_rejected(self):
        self.login(None)
        self.assertEqual(self.client.post(BASE+'/entries',json={'title':'TEST ONLY denied','body':'TEST ONLY'}).status_code,401)
        pending=self.action(self.create(),'submit').json['entry']
        with app.app_context():
            db.session.get(User,3).is_active=False;db.session.commit()
        self.assertEqual(self.action(pending,'approve',3).status_code,401)
        with app.app_context():
            self.assertEqual(db.session.get(HubRevision,db.session.get(HubEntry,pending['id']).working_revision_id).state,'pending')
