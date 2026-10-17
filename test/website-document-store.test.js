import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createNotebook,validateCatalogueMetadata} from '../src/model.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
import {validWebsiteSelection} from '../src/web/website-selection.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {WebsiteEditorStore} from '../src/website-editor-store.js';
import {readWebsiteDocumentRegistry,websiteDocumentLocks} from '../src/website-document-registry.js';
import {catalogueFormat,catalogueRequiresDomains,catalogueRequiresSettings,catalogueRequiresWebsites,requireWebsiteDocuments,requireWorkspaceDomains,requireWorkspaceSettings,requireRecordResultIndexes} from '../src/catalogue-format.js';
import {digest,serialize} from '../src/storage-format.js';
import {seal,unseal} from '../src/encryption.js';
const selection=()=>({defaultShare:false,includeProjects:[],records:[]});
function site(metadata,name='Independent website'){
 return {id:randomUUID(),name,projectId:null,document:websiteDocument(metadata),projects:metadata.projects.map(({id,share,logoId})=>({id,share,logoId:logoId??null})),selection:selection()};
}
function fixture({projectId=null,legacySite=false,populated=false}={}){
 const metadata=createNotebook('Website document fixture'),states=new Map(),snapshots=new Map(),key=randomBytes(32),queries=[];let head,version=3,writes=0;
 if(populated)metadata.projects=[{id:randomUUID(),title:'Retained project',description:'',share:true,logoId:null}];
 if(legacySite)metadata.websites=[site(metadata,'Earlier inline website')];
 const advance=(snapshot={metadata})=>{snapshot={records:[],...snapshot};head=digest(serialize(snapshot));snapshots.set(head,structuredClone(snapshot));return head;};advance();
 const range=args=>[...states.keys()].filter(key=>(!args[0]||key>=args[0])&&(!args[1]||key<args[1])&&(!args[2]||key>args[2])).sort();
 const db={id:randomUUID(),
  async all(sql,...args){queries.push(sql);if(sql==='SELECT version FROM catalogue_format')return [{version}];if(sql.startsWith('SELECT slot,payload FROM state WHERE slot=ANY'))return args[0].filter(slot=>states.has(slot)).map(slot=>({slot,payload:states.get(slot)}));assert.fail(sql);},
  async get(sql,...args){
   queries.push(sql);
   if(sql.startsWith('SELECT pg_catalog.pg_try_advisory'))return {locked:true};
   if(sql.startsWith('SELECT count(*)')){const keys=range(args).slice(0,1024);return {count:String(keys.length),last:keys.at(-1)??null};}
   if(sql.includes('FROM state WHERE slot=$1'))return states.has(args[0])?{payload:states.get(args[0])}:undefined;
   if(sql.startsWith('SELECT 1 FROM state'))return range(args).length?{exists:1}:undefined;
   assert.fail(sql);
  },
  async run(sql,...args){
   queries.push(sql);writes++;
   if(sql.startsWith('ALTER TABLE catalogue_format')||sql.startsWith('CREATE INDEX records_scope_revision'))return;
   if(sql.startsWith('UPDATE catalogue_format')){version=Math.max(version,args[0]);return;}
   if(sql.startsWith('INSERT INTO state')){for(let i=0;i<args.length;i+=2){if(states.has(args[i])&&!sql.includes('ON CONFLICT'))throw Object.assign(Error('Duplicate state'),{code:'23505'});states.set(args[i],Buffer.from(args[i+1]));}return;}
   if(sql==='DELETE FROM state WHERE slot=$1'){states.delete(args[0]);return;}
   if(sql==='UPDATE state SET payload=$1 WHERE slot=$2'){states.set(args[1],Buffer.from(args[0]));return;}
   assert.fail(sql);
  },
  async *rows(sql,args){assert.match(sql,/SELECT slot,payload FROM state/);for(const slot of range(args))yield {slot,payload:states.get(slot)};}
 };
 const store={db,workspace:{projectId,labBookId:null},async head(){return head;},async snapshot(id=head){const value=snapshots.get(id);if(!value)throw Object.assign(Error('Missing snapshot'),{code:'RECORD_HISTORY_MISSING'});return structuredClone(value);},
  encode(kind,id,value){return seal(Buffer.from(serialize(value)),key,metadata.id+'/'+kind+'/'+id);},decode(kind,id,value){if(!value)throw Object.assign(Error('Missing value'),{code:'CATALOGUE_DAMAGED'});return JSON.parse(unseal(value,key,metadata.id+'/'+kind+'/'+id).toString());},
  async validateMetadata(_before,value){validateCatalogueMetadata(value);},async member(){return null;},async *members(snapshot){yield* snapshot.records;},async *queryDocuments(rows){for await(const row of rows)assert.fail('Unexpected fixture record '+row.id);}
 };
 return {store,states,snapshots,metadata,queries,advance,get writes(){return writes;},close(){key.fill(0);}};
}
async function initialized(t,options){const f=fixture(options);t.after(f.close);f.original=await f.store.head();f.owner=new WebsiteDocumentStore(f.store);f.registry=await f.owner.initialize(f.original,await f.store.snapshot(),{defaultSelection:selection()});f.current=f.advance({metadata:{...f.metadata,websites:undefined},websiteDocuments:1});return f;}

test('legacy website reads retain exact inline snapshots without writing or manufacturing owners',async t=>{
 const f=fixture({legacySite:true,projectId:randomUUID()});t.after(f.close);const owner=new WebsiteDocumentStore(f.store),original=await f.store.head(),before=serialize(await f.store.snapshot()),named=f.metadata.websites[0];
 const legacy=await owner.read(named.id,{researchSnapshotId:original});assert.deepEqual(legacy.site,named);assert.equal(legacy.websiteRevision,null);
 const base=await owner.read(null,{researchSnapshotId:original});assert.equal(base.websiteId,null);assert.equal(base.websiteRevision,null);assert.deepEqual(base.site.document,websiteDocument(f.metadata));assert.equal(base.site.selection,undefined);
 assert.equal(f.writes,0);assert.equal(serialize(await f.store.snapshot()),before);assert.equal(await readWebsiteDocumentRegistry(f.store),null);
 await owner.initialize(original,await f.store.snapshot(),{defaultSelection:selection()});assert.equal((await owner.head(null)).websiteRevision.length,64);
 await assert.rejects(owner.create(site(f.metadata),{researchSnapshotId:original}),{code:'INVALID'});
 assert.deepEqual((await owner.read(named.id,{researchSnapshotId:original})).site,named);assert.equal(serialize(await f.store.snapshot(original)),before);
});

test('current website edits own separate heads while pinned documents and research snapshots stay exact',async t=>{
 const f=await initialized(t),owner=f.owner,a=site(f.metadata,'First'),b=site(f.metadata,'Second');
 a.document.pages=Array.from({length:12},(_,i)=>({id:randomUUID(),title:'Page '+i,body:'Exact observations '.repeat(600),share:true,sections:[]}));
 const first=await owner.create(a,{researchSnapshotId:f.current}),second=await owner.create(b,{researchSnapshotId:f.current}),registry=serialize(await owner.registry()),research=serialize(await f.store.snapshot());
 const changed=structuredClone(a);changed.document.pages[11].body='Revised selected page';const next=await owner.save(a.id,changed,{researchSnapshotId:f.current,expectedRevision:first.websiteRevision});
 assert.notEqual(next.websiteRevision,first.websiteRevision);assert.equal((await owner.head(b.id)).websiteRevision,second.websiteRevision);assert.equal(serialize(await owner.registry()),registry);assert.equal(serialize(await f.store.snapshot()),research);
 assert.deepEqual((await owner.read(a.id,{researchSnapshotId:f.current,websiteRevision:first.websiteRevision})).site,a);assert.deepEqual((await owner.read(a.id)).site,changed);
 assert.equal((await owner.save(a.id,changed,{researchSnapshotId:f.current,expectedRevision:next.websiteRevision})).websiteRevision,next.websiteRevision);
 await assert.rejects(owner.save(a.id,a,{researchSnapshotId:f.current,expectedRevision:first.websiteRevision}),{code:'CONFLICT'});
 const {document}=await owner.document(a.id,{researchSnapshotId:f.current,websiteRevision:first.websiteRevision});assert.equal((await document.field(['document','pages','11','body'])).value,a.document.pages[11].body);
 f.advance({metadata:{...f.metadata,revision:1},websiteDocuments:1});await assert.rejects(owner.read(a.id,{researchSnapshotId:f.current}),{code:'INVALID'});
 assert.deepEqual((await owner.read(a.id,{researchSnapshotId:f.current,websiteRevision:first.websiteRevision})).site,a);await owner.verify();
});

test('directory pages never hydrate unrelated documents and removed sites retain exact old revisions',async t=>{
 const f=await initialized(t),owner=f.owner,created=[];
 for(let i=0;i<7;i++)created.push(await owner.create(site(f.metadata,'Site '+i),{researchSnapshotId:f.current}));
 const decode=f.store.decode;f.store.decode=function(kind,id,payload){assert.ok(!id.startsWith('website-document:block:'),'Directory hydrated a website document');return decode.call(this,kind,id,payload);};
 let after=null,all=[];do{const page=await owner.list({after,limit:2});all.push(...page.sites);after=page.next;}while(after!==null);f.store.decode=decode;
 assert.equal(all.length,created.length);assert.equal(new Set(all.map(s=>s.websiteId)).size,created.length);
 after=null;all=[];do{const page=await owner.list({after,limit:1,includeDefault:true});all.push(...page.sites);after=page.next;}while(after!==null);assert.equal(all.length,created.length+1);assert.equal(all.filter(site=>site.websiteId===null).length,1);
 const defaultValue=await owner.read(null);assert.equal(defaultValue.websiteId,null);assert.equal(defaultValue.site.id,f.registry.defaultSiteId);
 await websiteDocumentLocks(f.store,{websiteIds:[null]});
 const selected=created[0],original=await owner.read(selected.websiteId);await owner.remove(selected.websiteId,{expectedRevision:selected.websiteRevision});
 await assert.rejects(owner.read(selected.websiteId),{code:'NOT_FOUND'});assert.deepEqual((await owner.read(selected.websiteId,{websiteRevision:selected.websiteRevision})).site,original.site);
 assert.equal((await owner.list()).sites.length,created.length-1);await assert.rejects(owner.remove(null,{expectedRevision:(await owner.head(null)).websiteRevision}),{code:'INVALID'});await owner.verify();
});

test('independent verification detects missing registries, missing heads and corrupted website block identity',async t=>{
 const f=await initialized(t),owner=f.owner;await owner.verify();
 const registry=f.states.get('website-documents');f.states.delete('website-documents');await assert.rejects(owner.verify(),{code:'CATALOGUE_DAMAGED'});f.states.set('website-documents',registry);
 const head='website-document:head:'+f.registry.defaultSiteId,saved=f.states.get(head);f.states.delete(head);await assert.rejects(owner.read(null),{code:'CATALOGUE_DAMAGED'});f.states.set(head,saved);
 const block=[...f.states.keys()].find(slot=>slot.startsWith('website-document:block:')),original=f.states.get(block);f.states.set(block,f.store.encode('state',block,{type:'inline',value:'substituted'}));
 await assert.rejects(owner.verify(),{code:'CATALOGUE_DAMAGED'});f.states.set(block,original);await owner.verify();
 const alien='website-document:block:'+randomUUID()+':value:'+digest(serialize({type:'inline',value:null}));f.states.set(alien,f.store.encode('state',alien,{type:'inline',value:null}));await assert.rejects(owner.verify(),{code:'CATALOGUE_DAMAGED'});
});

test('website capability admission preserves required module and settings owners and lock ordering',async()=>{
 for(const [before,after] of [[3,29],[22,30],[23,29],[24,30],[25,31],[26,29],[27,30],[28,31],[29,29],[30,30],[31,31]]){
  let version=before;const db={async all(){return [{version}];},async get(){return null;},async run(sql,...args){if(sql.startsWith('UPDATE catalogue_format'))version=Math.max(version,args[0]);}};
  const domains=catalogueRequiresDomains(before),settings=catalogueRequiresSettings(before);await requireWebsiteDocuments(db);assert.equal(await catalogueFormat(db),after);assert.equal(catalogueRequiresWebsites(after),true);assert.equal(catalogueRequiresDomains(after),domains);assert.equal(catalogueRequiresSettings(after),settings);
  await requireRecordResultIndexes(db);assert.equal(version,after);await requireWorkspaceDomains(db);assert.equal(version,settings?31:30);await requireWorkspaceSettings(db);assert.equal(version,31);
 }
 const calls=[],store={db:{id:'owner',async all(){return [{version:3}];},async get(sql,key){if(!sql.startsWith('SELECT pg_catalog.pg_try_advisory'))return;calls.push({sql,key});return {locked:true};}}},ids=[randomUUID(),randomUUID()];
 await websiteDocumentLocks(store,{websiteIds:ids,registration:true,membership:'exclusive'});
 assert.match(calls[0].key,/lifecycle/);assert.match(calls[0].sql,/lock_shared/);assert.match(calls[1].key,/website-membership/);assert.doesNotMatch(calls[1].sql,/lock_shared/);assert.match(calls[2].key,/website-registration/);assert.deepEqual(calls.slice(3).map(c=>c.key.split('/').at(-1)),ids.sort());
});

test('tree-backed website selections admit complete existing consent beyond the old aggregate cap',()=>{
 const value={defaultShare:false,includeProjects:Array.from({length:101},()=>randomUUID()),records:Array.from({length:1001},()=>({id:randomUUID(),share:true,attachments:[]}))};
 assert.equal(validWebsiteSelection(value),true);value.records.push(value.records[0]);assert.equal(validWebsiteSelection(value),false);
});


test('default internal UUID cannot select named ownership and live heads must match current membership',async t=>{
 const f=await initialized(t,{populated:true}),owner=f.owner,current=await owner.read(null),id=f.registry.defaultSiteId;
 for(const call of [()=>owner.head(id),()=>owner.read(id),()=>owner.save(id,current.site,{researchSnapshotId:f.current,expectedRevision:current.websiteRevision}),()=>websiteDocumentLocks(f.store,{websiteIds:[id]})])await assert.rejects(call(),{code:'INVALID'});
 const original=await f.store.snapshot(f.current);f.advance({...original,metadata:{...original.metadata,projects:[],notebooks:[]}});
 assert.deepEqual((await owner.read(null,{researchSnapshotId:f.current,websiteRevision:current.websiteRevision})).site,current.site);
 await assert.rejects(owner.verify(),{code:'CATALOGUE_DAMAGED'});
});


test('first selected edit accepts an unchanged inline reader and rejects it after a separate saved edit',async t=>{
 const f=await initialized(t),editor=new WebsiteEditorStore(f.store),websitePin={researchSnapshotId:f.original,websiteId:null,websiteRevision:null};
 const command={websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'settings',path:['document','website','footer'],value:'New selected footer'}]};
 const draft=await editor.change(null,command);assert.notEqual(draft.websitePin.websiteRevision,null);assert.equal(draft.site.document.website.footer,'New selected footer');assert.deepEqual(await editor.change(null,command),draft);
 await editor.discard(null,{draftId:draft.draft.id,expectedRevision:draft.draft.revision,commandId:randomUUID()});
 const saved=await f.owner.read(null),changed=structuredClone(saved.site);changed.document.website.footer='Another tab saved';await f.owner.save(null,changed,{researchSnapshotId:f.current,expectedRevision:saved.websiteRevision});
 await assert.rejects(editor.change(null,{...command,commandId:randomUUID()}),{code:'CONFLICT'});assert.equal((await f.owner.read(null)).site.document.website.footer,'Another tab saved');
});
