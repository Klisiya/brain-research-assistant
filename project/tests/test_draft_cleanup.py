"""TEST ONLY: server draft deletion and revision discard; memory DB/temp assets."""
from io import BytesIO
import json
import unittest
from sqlalchemy import event, text
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
from app import app, db, HubEntry, HubRevision, HubAttachment, HubModerationEvent, HubDeletionAudit, HubDiscussion, HubReport, FileAsset


class DraftCleanupTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    tearDownClass = fixtures.AttachmentTests.tearDownClass
    login = fixtures.AttachmentTests.login

    def root(self, kind):
        return {'faculty':'/api/hub/entries','industry':'/api/hub/industry/entries','thread':'/api/hub/discussions/entries','reply':'/api/hub/discussions/entries'}[kind]

    def owner(self, kind): return 4 if kind in ['thread','reply'] else 1

    def create(self, kind):
        parent = self.publish('thread', self.create('thread')) if kind == 'reply' else None
        self.login(self.owner(kind))
        body = {'title':'TEST ONLY CleanupAlpha','body':'TEST ONLY body must not enter audit'}
        if kind == 'industry': body['sourceName'] = 'TEST ONLY source'
        if kind == 'reply': body.pop('title')
        response = self.client.post(self.root(kind)+(f"/{parent['id']}/replies" if parent else ''), json=body)
        self.assertEqual(response.status_code,201,response.json)
        return response.json['entry']

    def action(self, kind, entry, action, uid=None, **extra):
        self.login(self.owner(kind) if uid is None else uid)
        return self.client.post(f"{self.root(kind)}/{entry['id']}/{action}",json={'expectedVersion':entry['version'],**extra})

    def publish(self, kind, entry):
        pending = self.action(kind,entry,'submit'); self.assertEqual(pending.status_code,200,pending.json)
        live = self.action(kind,pending.json['entry'],'approve',3); self.assertEqual(live.status_code,200,live.json)
        return live.json['entry']

    def delete(self, kind, entry, uid=None, **extra):
        self.login(self.owner(kind) if uid is None else uid)
        return self.client.delete(f"{self.root(kind)}/{entry['id']}",json={'expectedVersion':entry['version'],'confirmation':'DELETE',**extra})

    def discard(self, kind, entry, uid=None, **extra):
        return self.action(kind,entry,'discard-revision',uid,confirmation='DISCARD',**extra)

    def clean(self):
        with app.app_context(): self.assertEqual(db.session.execute(text('PRAGMA foreign_key_check')).all(),[])

    def test_four_types_delete_draft_rejected_pending_withdraw_and_privacy(self):
        for kind in ['faculty','industry','thread','reply']:
            for rejected in [False,True]:
                with self.subTest(kind=kind,rejected=rejected):
                    entry=self.create(kind)
                    self.login(2);search_before=self.client.get('/api/search?q=CleanupAlpha&type=hub').json
                    parent_before=self.client.get(f"/api/hub/discussions/entries/{entry['threadId']}").json if kind=='reply' else None
                    self.assertEqual(self.delete(kind,entry,2).status_code,404)
                    if rejected:
                        pending=self.action(kind,entry,'submit').json['entry']
                        self.assertEqual(self.delete(kind,pending).status_code,409)
                        entry=self.action(kind,pending,'reject',3,reviewNote='TEST ONLY reason').json['entry']
                    self.assertEqual(self.delete(kind,entry).status_code,200)
                    self.login(2);self.assertEqual(self.client.get('/api/search?q=CleanupAlpha&type=hub').json,search_before)
                    if parent_before:self.assertEqual(self.client.get(f"/api/hub/discussions/entries/{entry['threadId']}").json,parent_before)
                    with app.app_context():
                        self.assertIsNone(db.session.get(HubEntry,entry['id']))
                        self.assertEqual(db.session.query(HubRevision).filter_by(entry_id=entry['id']).count(),0)
                        self.assertEqual(db.session.query(HubModerationEvent).filter_by(entry_id=entry['id']).count(),0)
                        if kind in ['thread','reply']: self.assertIsNone(db.session.get(HubDiscussion,entry['id']))
                        audit=db.session.query(HubDeletionAudit).filter_by(original_entry_id=entry['id']).one()
                        self.assertEqual(audit.actor_id,self.owner(kind)); self.assertNotIn('body',json.dumps(audit.snapshot)); self.assertEqual(audit.snapshot['kind'],'discussions' if kind in ['thread','reply'] else kind)
                    self.clean()
            pending=self.action(kind,self.create(kind),'submit').json['entry']
            self.assertEqual(self.delete(kind,pending,3).status_code,409)
            draft=self.action(kind,pending,'withdraw').json['entry']
            self.assertEqual(self.delete(kind,draft).status_code,200)

    def test_four_types_discard_preserves_public_search_reports_and_version_history(self):
        for kind in ['faculty','industry','thread','reply']:
            with self.subTest(kind=kind):
                live=self.publish(kind,self.create(kind))
                self.assertEqual(self.delete(kind,live).status_code,403)
                if kind=='faculty': self.assertEqual(self.delete(kind,live,3).status_code,403)
                self.login(2); before=self.client.get(f"{self.root(kind)}/{live['id']}").json
                search=self.client.get('/api/search?q=CleanupAlpha&type=hub').json
                report_id=None
                if kind in ['thread','reply']:
                    report=self.client.post(f"{self.root(kind)}/{live['id']}/reports",json={'reason':'TEST ONLY report'})
                    report_id=report.json['report']['id']
                with app.app_context(): published_id=db.session.get(HubEntry,live['id']).published_revision_id
                draft=self.action(kind,live,'draft').json['entry']
                self.assertEqual(self.discard(kind,draft,2).status_code,404)
                stale=dict(draft);stale['version']-=1
                self.assertEqual(self.discard(kind,stale).status_code,409)
                pending=self.action(kind,draft,'submit').json['entry']
                self.assertEqual(self.discard(kind,pending).status_code,409)
                draft=self.action(kind,pending,'withdraw').json['entry']
                discarded=self.discard(kind,draft);self.assertEqual(discarded.status_code,200,discarded.json)
                result=discarded.json['entry']; self.assertIsNone(result['working']);self.assertEqual(result['version'],draft['version']+1)
                self.login(2);self.assertEqual(self.client.get(f"{self.root(kind)}/{live['id']}").json,before)
                self.assertEqual(self.client.get('/api/search?q=CleanupAlpha&type=hub').json,search)
                with app.app_context():
                    row=db.session.get(HubEntry,live['id']);self.assertEqual(row.published_revision_id,published_id);self.assertIsNone(row.working_revision_id)
                    if report_id:self.assertEqual(db.session.get(HubReport,report_id).target_entry_id,live['id'])
                    receipt=db.session.query(HubDeletionAudit).filter_by(original_entry_id=live['id']).one();self.assertEqual(len(receipt.snapshot['discardedRevisions']),1);self.assertNotIn('body',json.dumps(receipt.snapshot))
                # Rejected v3 remains in history; discard v4, then allocate v5 without conflict/reuse.
                draft=self.action(kind,result,'draft').json['entry'];self.assertEqual(draft['working']['number'],3)
                pending=self.action(kind,draft,'submit').json['entry']
                rejected=self.action(kind,pending,'reject',3,reviewNote='TEST ONLY revision reason').json['entry']
                draft=self.action(kind,rejected,'draft').json['entry'];self.assertEqual(draft['working']['number'],4)
                result=self.discard(kind,draft).json['entry']
                draft=self.action(kind,result,'draft').json['entry'];self.assertEqual(draft['working']['number'],5)
                result=self.discard(kind,draft,3).json['entry']
                self.assertEqual(self.discard(kind,draft).status_code,409)
                with app.app_context(): self.assertEqual(len(db.session.query(HubDeletionAudit).filter_by(original_entry_id=live['id']).one().snapshot['discardedRevisions']),3)
                if kind!='faculty':self.assertEqual(self.delete(kind,result,3).status_code,200)
                self.clean()

    def upload(self,kind,entry,image=False):
        self.login(self.owner(kind)); response=self.client.post(f"{self.root(kind)}/{entry['id']}/attachments",content_type='multipart/form-data',data={'expectedVersion':str(entry['version']),'displayName':'TEST ONLY material','attachmentType':'cover' if image else 'pdf','file':(BytesIO(fixtures.png() if image else fixtures.pdf()),'TEST.png' if image else 'TEST.pdf','image/png' if image else 'application/pdf')})
        self.assertEqual(response.status_code,201,response.json);return response.json['entry']

    def test_discard_attachment_references_only_and_download_revocation(self):
        for kind in ['faculty','industry']:
            live=self.publish(kind,self.upload(kind,self.create(kind)))
            public_url=live['published']['attachments'][0]['downloadUrl']
            draft=self.upload(kind,self.action(kind,live,'draft').json['entry'],True)
            private_urls=[a['downloadUrl'] for a in draft['working']['attachments']]
            with app.app_context():
                working_id=db.session.get(HubEntry,live['id']).working_revision_id
                rows=db.session.query(HubAttachment).filter_by(revision_id=working_id).order_by(HubAttachment.id).all()
                shared_id,exclusive_id=[row.asset_id for row in rows]
            result=self.discard(kind,draft);self.assertEqual(result.status_code,200,result.json)
            self.login(self.owner(kind));response=self.client.get(public_url);self.assertEqual(response.status_code,200);response.close()
            for url in private_urls:self.assertEqual(self.client.get(url).status_code,404)
            with app.app_context():
                self.assertIsNotNone(db.session.get(FileAsset,shared_id));self.assertIsNone(db.session.get(FileAsset,exclusive_id));self.assertIsNone(db.session.get(HubRevision,working_id));self.assertEqual(db.session.query(HubAttachment).filter_by(revision_id=working_id).count(),0)
            self.clean()

    def test_faculty_delete_cleans_exclusive_and_preserves_shared_asset(self):
        entry=self.upload('faculty',self.create('faculty'))
        other=self.create('faculty')
        with app.app_context():
            one=db.session.get(HubEntry,entry['id']);two=db.session.get(HubEntry,other['id'])
            attachment=db.session.query(HubAttachment).filter_by(revision_id=one.working_revision_id).one();asset_id=attachment.asset_id
            db.session.add(HubAttachment(revision_id=two.working_revision_id,asset_id=asset_id,display_name='TEST ONLY shared'));db.session.commit()
        self.assertEqual(self.delete('faculty',entry).status_code,200)
        with app.app_context():self.assertIsNotNone(db.session.get(FileAsset,asset_id))
        self.assertEqual(self.delete('faculty',other).status_code,200)
        with app.app_context():self.assertIsNone(db.session.get(FileAsset,asset_id))
        self.clean()

    def test_discard_failure_is_atomic_and_confirmation_auth_are_required(self):
        live=self.publish('faculty',self.upload('faculty',self.create('faculty')))
        draft=self.action('faculty',live,'draft').json['entry']
        self.login(None)
        self.assertEqual(self.client.post(f"/api/hub/entries/{draft['id']}/discard-revision",json={'expectedVersion':draft['version'],'confirmation':'DISCARD'}).status_code,401)
        raw=app.test_client()
        with raw.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1;session['_fresh']=True
        self.assertEqual(raw.post(f"/api/hub/entries/{draft['id']}/discard-revision",json={'expectedVersion':draft['version'],'confirmation':'DISCARD'}).status_code,403)
        self.login(1);self.assertEqual(self.client.post(f"/api/hub/entries/{draft['id']}/discard-revision",json={'expectedVersion':draft['version'],'confirmation':'DELETE'}).status_code,400)
        def fail(*args): raise SQLAlchemyError('TEST ONLY injected failure')
        event.listen(HubDeletionAudit,'before_insert',fail)
        try:self.assertEqual(self.discard('faculty',draft).status_code,503)
        finally:event.remove(HubDeletionAudit,'before_insert',fail)
        self.login(1);fresh=self.client.get(f"/api/hub/entries/{draft['id']}/manage").json['entry'];self.assertEqual(fresh,draft)
        self.assertEqual(self.discard('faculty',draft).status_code,200)
        self.login(1);live=self.client.get(f"/api/hub/entries/{draft['id']}/manage").json['entry']
        draft=self.action('faculty',live,'draft').json['entry']
        event.listen(HubDeletionAudit,'before_update',fail)
        try:self.assertEqual(self.discard('faculty',draft).status_code,503)
        finally:event.remove(HubDeletionAudit,'before_update',fail)
        self.login(1);self.assertEqual(self.client.get(f"/api/hub/entries/{draft['id']}/manage").json['entry'],draft)
        self.assertEqual(self.discard('faculty',draft).status_code,200)
        self.clean()


if __name__=='__main__':unittest.main()
