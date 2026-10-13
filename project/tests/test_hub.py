"""R8A1 TEST ONLY, domain-neutral fixtures in memory and temporary storage."""
from io import BytesIO
import struct
import unittest
from unittest.mock import patch
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
import test_attachments as fixtures
from app import app, db, User, HubEntry, HubRevision, HubAttachment, HubModerationEvent, FileAsset, Paper


def legacy_office(kind, extra=None):
    """Minimal unencrypted CFB fixture; never a production resource or seed."""
    word = bytearray(4096); word[:2] = b'\xec\xa5'
    current = bytearray(4096); struct.pack_into('<I', current, 12, 0xe391c05f)
    ppt = struct.pack('<HHI', 15, 1000, 4088) + bytes(4088)
    streams = [('WordDocument', bytes(word)), ('0Table', bytes(4096))] if kind == 'document' else [('PowerPoint Document', ppt), ('Current User', bytes(current))]
    if extra:
        streams.append((extra, bytes(4096)))
    header = bytearray(512); header[:8] = bytes.fromhex('d0cf11e0a1b11ae1')
    struct.pack_into('<HHHHH', header, 24, 0x3e, 3, 0xfffe, 9, 6)
    struct.pack_into('<IIIIIIIII', header, 40, 0, 1, 1, 0, 4096, 0xfffffffe, 0, 0xfffffffe, 0)
    struct.pack_into('<109I', header, 76, 0, *([0xffffffff]*108))
    fat = [0xfffffffd, 0xfffffffe]
    directory = bytearray(512)
    def node(offset, name, kind, start, size, child=0xffffffff, right=0xffffffff):
        label = (name+'\0').encode('utf-16le'); directory[offset:offset+len(label)] = label
        struct.pack_into('<HBBIII', directory, offset+64, len(label), kind, 1, 0xffffffff, right, child)
        struct.pack_into('<IQ', directory, offset+116, start, size)
    node(0, 'Root Entry', 5, 0xfffffffe, 0, child=1)
    for index, (name, content) in enumerate(streams):
        start = 2 + index*8
        node((index+1)*128, name, 2, start, len(content), right=index+2 if index+1<len(streams) else 0xffffffff)
        fat.extend(list(range(start+1, start+8))+[0xfffffffe])
    return bytes(header)+struct.pack('<128I', *(fat+[0xffffffff]*(128-len(fat))))+bytes(directory)+b''.join(content for _,content in streams)


class HubTests(unittest.TestCase):
    setUp = fixtures.AttachmentTests.setUp
    tearDown = fixtures.AttachmentTests.tearDown
    login = fixtures.AttachmentTests.login
    tearDownClass = fixtures.AttachmentTests.tearDownClass

    def create(self, uid=1, title='TEST ONLY Neutral Resource'):
        self.login(uid)
        response = self.client.post('/api/hub/entries', json=dict(title=title, body='TEST ONLY text', sourceName='TEST ONLY source', sourceUrl='https://example.test/source'))
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['entry']

    def action(self, entry, action, uid=1, **data):
        self.login(uid)
        return self.client.post(f"/api/hub/entries/{entry['id']}/{action}", json=dict(expectedVersion=entry['version'], **data))

    def publish(self, entry):
        response = self.action(entry, 'submit'); self.assertEqual(response.status_code,200,response.json)
        response = self.action(response.json['entry'], 'approve', 3); self.assertEqual(response.status_code,200,response.json)
        return response.json['entry']

    def upload(self, entry, kind='pdf', data=None, extension=None):
        self.login()
        ext = extension or {'pdf':'pdf','cover':'png','slides':'pptx','document':'docx'}[kind]
        mime = {'ppt':'application/vnd.ms-powerpoint','doc':'application/msword'}.get(ext) or fixtures.FORMATS[kind][ext]
        content = data if data is not None else fixtures.pdf() if kind=='pdf' else fixtures.png() if kind=='cover' else fixtures.office(kind)
        return self.client.post(f"/api/hub/entries/{entry['id']}/attachments", data=dict(expectedVersion=str(entry['version']),displayName='TEST ONLY material',attachmentType=kind,file=(BytesIO(content),'TEST.'+ext,mime)), content_type='multipart/form-data')

    def test_anonymous_all_hub_reads_and_writes_denied(self):
        entry=self.publish(self.create())
        self.login(None)
        for path in ['/api/hub/entries',f"/api/hub/entries/{entry['id']}",f"/api/hub/entries/{entry['id']}/manage",f"/api/hub/entries/{entry['id']}/history"]:
            self.assertEqual(self.client.get(path).status_code,401)
        self.assertEqual(self.client.post('/api/hub/entries',json={'title':'TEST'}).status_code,401)
        self.assertEqual(self.client.get('/api/search?q=Neutral&type=hub').status_code,401)
        response=self.client.get('/api/search?q=Neutral').json
        self.assertEqual(response['counts']['hub'],0);self.assertEqual(response['items'],[])

    def test_teacher_submit_reject_edit_resubmit_admin_publish_persistence(self):
        entry=self.create()
        self.assertEqual(self.action(entry,'approve').status_code,403)
        self.assertEqual(self.action(entry,'reject',reviewNote='TEST').status_code,403)
        self.assertEqual(self.action(entry,'archive').status_code,403)
        self.assertEqual(self.action(entry,'approve',3).status_code,409)
        pending=self.action(entry,'submit').json['entry']
        self.assertEqual(pending['working']['state'],'pending')
        self.assertEqual(self.client.patch(f"/api/hub/entries/{entry['id']}",json=dict(expectedVersion=pending['version'],title='Illegal')).status_code,409)
        rejected=self.action(pending,'reject',3,reviewNote='TEST ONLY revise').json['entry']
        draft=self.action(rejected,'draft').json['entry']
        self.assertEqual(draft['working']['number'],2)
        self.assertEqual(draft['working']['state'],'draft')
        changed=self.client.patch(f"/api/hub/entries/{entry['id']}",json=dict(expectedVersion=draft['version'],title='TEST ONLY Revised',body='TEST ONLY revised body')).json['entry']
        published=self.publish(changed)
        self.login(4)
        detail=self.client.get(f"/api/hub/entries/{entry['id']}").json['entry']
        self.assertEqual(detail['published']['title'],'TEST ONLY Revised')
        for key in ['working','ownerId','version']:self.assertNotIn(key,detail)
        self.assertNotIn('reviewNote',detail['published'])
        self.assertEqual(self.client.get('/api/hub/entries').json['entries'][0],detail)
        self.login(1)
        history=self.client.get(f"/api/hub/entries/{entry['id']}/history").json['events']
        self.assertEqual(history[0]['action'],'approved')
        self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}/manage").json['entry'],published)

    def test_idor_and_nonpublic_states_never_leak(self):
        entry=self.create()
        for expected in ['draft','pending','rejected']:
            for uid in [2,4]:
                self.login(uid)
                for suffix in ['', '/manage','/history']:
                    self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}"+suffix).status_code,404)
                self.assertEqual(self.client.patch(f"/api/hub/entries/{entry['id']}",json=dict(expectedVersion=entry['version'],title='IDOR')).status_code,404)
                self.assertEqual(self.client.get('/api/hub/entries').json['entries'],[])
                self.assertEqual(self.client.get('/api/search?q=Neutral').json['counts']['hub'],0)
            if expected=='draft':entry=self.action(entry,'submit').json['entry']
            if expected=='pending':entry=self.action(entry,'reject',3,reviewNote='TEST ONLY').json['entry']

    def test_invalid_fields_roles_and_transition_tokens(self):
        entry=self.create()
        for data in [{'title':'TEST','ownerId':2},{'title':'TEST','kind':'industry'},{'title':'TEST','state':'published'}, {'title':[]}, {'title':'x'*201}, {'title':'TEST','sourceUrl':'javascript:alert(1)'}]:
            self.assertEqual(self.client.post('/api/hub/entries',json=data).status_code,400)
        self.assertEqual(self.action(entry,'submit',reviewedById=3).status_code,400)
        self.assertEqual(self.client.patch(f"/api/hub/entries/{entry['id']}",json=dict(expectedVersion=entry['version']-1,title='Stale')).status_code,409)
        for scope in ['mine','review']:
            self.login(4);self.assertEqual(self.client.get('/api/hub/entries?scope='+scope).status_code,403)
        self.login(2);self.assertEqual(self.client.get('/api/hub/entries?scope=mine').json['entries'],[])
        self.assertEqual(self.client.get('/api/hub/entries?scope=review').status_code,403)
        self.login(4);self.assertEqual(self.client.post('/api/hub/entries',json={'title':'TEST'}).status_code,403)

    def test_files_all_formats_authorization_and_reference_safe_history(self):
        entry=self.create()
        for kind,extension in [('pdf',None),('cover',None),('slides',None),('document',None),('slides','ppt'),('document','doc')]:
            data=legacy_office(kind) if extension else None
            response=self.upload(entry,kind,data,extension)
            self.assertEqual(response.status_code,201,response.json)
            entry=response.json['entry']
        link=self.client.post(f"/api/hub/entries/{entry['id']}/attachments",json=dict(expectedVersion=entry['version'],displayName='TEST ONLY Link',externalUrl='https://example.test/resource'))
        self.assertEqual(link.status_code,201,link.json);entry=link.json['entry']
        path=entry['working']['attachments'][0]['downloadUrl']
        for uid,status in [(None,401),(2,404),(4,404),(1,200),(3,200)]:
            self.login(uid);response=self.client.get(path);self.assertEqual(response.status_code,status)
            if status==200:
                self.assertIn('attachment;',response.headers['Content-Disposition']);self.assertEqual(response.headers['Cache-Control'],'private, no-store');response.close()
        published=self.publish(entry)
        self.login(4);response=self.client.get(path);self.assertEqual(response.status_code,200);response.close()
        draft=self.action(published,'draft').json['entry'];attachment=draft['working']['attachments'][0]
        removed=self.client.delete(f"/api/hub/entries/{entry['id']}/attachments/{attachment['id']}",json=dict(expectedVersion=draft['version']))
        self.assertEqual(removed.status_code,200,removed.json)
        self.login(4);response=self.client.get(path);self.assertEqual(response.status_code,200);response.close()
        new=self.publish(removed.json['entry'])
        self.login(4);self.assertEqual(self.client.get(path).status_code,404)
        archived=self.action(new,'archive',3);self.assertEqual(archived.status_code,200)
        self.login(4);self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}").status_code,404)
        self.assertEqual(self.client.get('/api/search?q=Neutral&type=hub').json['total'],0)

    def test_bad_uploads_and_asset_binding_are_rejected(self):
        entry=self.create()
        for kind,ext,data in [('pdf','pdf',b'not pdf'),('slides','ppt',b'not ole'),('document','doc',legacy_office('slides')),('slides','ppt',legacy_office('slides','VBA'))]:
            response=self.upload(entry,kind,data,ext);self.assertEqual(response.status_code,400,response.json)
        self.assertEqual(self.client.post(f"/api/hub/entries/{entry['id']}/attachments",json=dict(expectedVersion=entry['version'],displayName='TEST',externalUrl='https://example.test',assetId=1)).status_code,400)
        response=self.client.post(f"/api/hub/entries/{entry['id']}/attachments",json=dict(expectedVersion=entry['version'],displayName='TEST',externalUrl='file:///private'))
        self.assertEqual(response.status_code,400)
        with app.app_context():self.assertEqual(db.session.query(HubAttachment).count(),0)

    def test_published_edits_keep_snapshot_and_search_requires_signin(self):
        entry=self.publish(self.create(title='TEST ONLY OldSignal'))
        draft=self.action(entry,'draft').json['entry']
        changed=self.client.patch(f"/api/hub/entries/{entry['id']}",json=dict(expectedVersion=draft['version'],title='TEST ONLY SecretSignal',body='TEST ONLY')).json['entry']
        pending=self.action(changed,'submit').json['entry']
        for uid in [1,2,3,4]:
            self.login(uid)
            self.assertEqual(self.client.get('/api/search?q=SecretSignal&type=hub').json['total'],0)
            result=self.client.get('/api/search?q=OldSignal&type=hub').json
            self.assertEqual(result['total'],1);self.assertEqual(result['items'][0]['route'],f"/innovation-hub/faculty/{entry['id']}")
            self.assertEqual(self.client.get(f"/api/hub/entries/{entry['id']}").json['entry']['published']['title'],'TEST ONLY OldSignal')
        approved=self.action(pending,'approve',3).json['entry']
        self.login(4);self.assertEqual(self.client.get('/api/search?q=SecretSignal&type=hub').json['total'],1)
        self.assertEqual(self.client.get('/api/search?q=OldSignal&type=hub').json['total'],0)
        self.assertEqual(approved['published']['number'],2)

    def test_audit_failure_rolls_back_publication(self):
        pending=self.action(self.create(),'submit').json['entry']
        from sqlalchemy import event
        def fail_audit(*_args):raise SQLAlchemyError('TEST ONLY audit failure')
        event.listen(HubModerationEvent,'before_insert',fail_audit)
        try:self.assertEqual(self.action(pending,'approve',3).status_code,503)
        finally:event.remove(HubModerationEvent,'before_insert',fail_audit)
        self.login(1)
        current=self.client.get(f"/api/hub/entries/{pending['id']}/manage").json['entry']
        self.assertEqual(current['working']['state'],'pending');self.assertIsNone(current['published']);self.assertEqual(current['version'],pending['version'])

    def test_upload_failure_compensates_and_preserves_draft(self):
        entry=self.create()
        with patch.object(app.extensions['file_asset_service'],'create',side_effect=SQLAlchemyError('TEST ONLY')):
            self.assertEqual(self.upload(entry).status_code,503)
        self.assertEqual(list(self.backend.root.rglob('*.pdf')),[])
        with app.app_context():
            self.assertEqual(db.session.query(HubAttachment).count(),0);self.assertEqual(db.session.query(FileAsset).count(),0)

    def test_empty_pagination_cache_csrf_disabled_and_no_learning_writes(self):
        self.login(4)
        empty=self.client.get('/api/hub/entries');self.assertEqual(empty.json['entries'],[])
        self.assertEqual(empty.headers['Cache-Control'],'private, no-store')
        for query in ['page=0','page=10001','scope=unknown','page=1&page=2','kind=industry']:
            self.assertEqual(self.client.get('/api/hub/entries?'+query).status_code,400)
        entry=self.publish(self.create())
        self.login(4)
        with app.app_context():
            tables=[table for name,table in db.metadata.tables.items() if name.startswith('learning_')]
            before=[db.session.scalar(select(db.func.count()).select_from(table)) for table in tables]
        for _ in range(3):
            self.client.get('/api/hub/entries');self.client.get(f"/api/hub/entries/{entry['id']}");self.client.get('/api/search?q=Neutral')
        with app.app_context():self.assertEqual(before,[db.session.scalar(select(db.func.count()).select_from(table)) for table in tables])
        plain=app.test_client()
        with plain.session_transaction() as session:session['_user_id']='1:1';session['auth_version']=1
        self.assertEqual(plain.post('/api/hub/entries',json={'title':'TEST'}).status_code,403)
        self.login(1)
        with app.app_context():db.session.get(User,1).is_active=False;db.session.commit()
        self.assertEqual(self.client.get('/api/hub/entries?scope=mine').status_code,401)

    def test_search_hydration_rechecks_publication(self):
        entry=self.publish(self.create())
        self.login(4)
        from sqlalchemy import event
        fired=[]
        def archive(_connection,_cursor,statement,_parameters,_context,_many):
            if not fired and 'FROM hub_entries JOIN hub_revisions' in statement and 'hub_entries.id IN' in statement:
                fired.append(True)
                _connection.exec_driver_sql('UPDATE hub_entries SET archived_at = CURRENT_TIMESTAMP WHERE id = ?', (entry['id'],))
        with app.app_context():
            event.listen(db.engine,'before_cursor_execute',archive)
            try:
                result=self.client.get('/api/search?q=Neutral&type=hub')
                self.assertEqual(result.status_code,200);self.assertTrue(fired);self.assertEqual(result.json['items'],[])
            finally:event.remove(db.engine,'before_cursor_execute',archive)
