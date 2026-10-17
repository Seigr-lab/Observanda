import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {catalogueFormat,catalogueRequiresDomains,catalogueRequiresSettings,catalogueRequiresWebsites,catalogueRequiresStagedEvidence,requireStagedEvidence,requireProjectDomains,requireWorkspaceDomains,requireWorkspaceSettings,requireWebsiteDocuments,requireRecordResultIndexes} from '../src/catalogue-format.js';
import {writeCatalogueArchive,readCatalogueArchive} from '../src/postgres-archive.js';
import {seal} from '../src/encryption.js';
import {collaborationFixture} from './fixtures/collaboration.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {Workspace,digest} from '../src/storage.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {contentBuffer} from '../src/file-content.js';
import {projectSourceEvidenceOwner} from '../src/project-source-evidence-owner.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {LiveResearch} from '../src/collaboration/live-research.js';
import {readAccess,verifyAccess,createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {workspaceSettingsRegistry} from '../src/workspace-settings.js';
import {readWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {EvidenceCorrections} from '../src/evidence-corrections.js';

function catalogue(version,{optionalDomains=false}={}){
 return {version,retiredIndex:version>=23,
  async all(sql){assert.equal(sql,'SELECT version FROM catalogue_format');return [{version:this.version}];},
  async get(sql,slot){assert.equal(sql,'SELECT 1 FROM state WHERE slot=$1');assert.equal(slot,'project-domains');return optionalDomains?{found:1}:null;},
  async run(sql,...values){
   if(sql.startsWith('CREATE INDEX records_scope_revision')){assert.equal(this.retiredIndex,false,'The retained scope index must not be recreated');this.retiredIndex=true;}
   else if(sql.startsWith('UPDATE catalogue_format'))this.version=Math.max(this.version,values[0]);
   else assert.ok(sql.startsWith('ALTER TABLE catalogue_format'),sql);
  }
 };
}
const capabilities=version=>[catalogueRequiresDomains(version),catalogueRequiresSettings(version),catalogueRequiresWebsites(version)];
test('staged evidence upgrades preserve independent owner requirements in either admission order',async()=>{
 for(let before=3;before<=37;before++){
  const db=catalogue(before),prior=capabilities(before),expected=32+(prior[2]?3:0)+(prior[1]?2:prior[0]?1:0);
  await requireStagedEvidence(db);assert.equal(await catalogueFormat(db),expected);assert.deepEqual(capabilities(db.version),prior);assert.equal(db.retiredIndex,true);
  await requireStagedEvidence(db);await requireRecordResultIndexes(db);assert.equal(db.version,expected);assert.equal(catalogueRequiresStagedEvidence(db.version),true);
 }
 const legacy=catalogue(23,{optionalDomains:true});await requireStagedEvidence(legacy);assert.equal(legacy.version,33);
 for(const domains of [null,requireProjectDomains,requireWorkspaceDomains,requireWorkspaceSettings])for(const websites of [false,true])for(const stagedFirst of [false,true]){
  const db=catalogue(3);if(stagedFirst)await requireStagedEvidence(db);if(domains)await domains(db);if(websites)await requireWebsiteDocuments(db);if(!stagedFirst)await requireStagedEvidence(db);
  assert.equal(db.version,32+(websites?3:0)+(domains===requireWorkspaceSettings?2:domains?1:0));
  assert.deepEqual(capabilities(db.version),[!!domains,domains===requireWorkspaceSettings,websites]);
 }
});

test('archive version ten preserves every staged capability combination and rejects downgraded declarations',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-staged-archive-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-staged-archive-'));await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const file=path.join(directory,'catalogue.archive'),payload=seal(Buffer.from('Synthetic staged catalogue state'),randomBytes(32),'qualification'),tables={state:['slot','payload']};
 for(const format of [32,33,34,35,36,37]){
  const db=catalogue(format),domains=catalogueRequiresDomains(format)?['calculator']:[],restored=[];db.id=randomUUID();db.schema='obs_'+db.id.replaceAll('-','');let selected=db.schema;
  const all=db.all,run=db.run,get=db.get;
  db.get=async function(sql,...args){if(sql==="SELECT 1 FROM state WHERE slot='head'")return {found:1};return get.call(db,sql,...args);};
  db.all=async function(sql,...args){if(sql.startsWith('SELECT nspname FROM pg_catalog.pg_namespace '))return domains.map(domain=>({nspname:'obm_'+db.id.replaceAll('-','')+'_'+domain}));if(sql.startsWith('SELECT slot,payload FROM state'))return [{slot:'head',payload}];return all.call(db,sql,...args);};
  db.rows=async function*(sql){if(this.schema===db.schema&&sql.includes(' FROM state '))yield {slot:'head',payload_bytes:payload.length};};
  db.run=async function(sql,...args){if(sql.startsWith('SET LOCAL search_path')){selected=sql.split('"')[1];return;}if(sql.startsWith('CREATE SCHEMA')||sql.startsWith('REVOKE ')||sql.startsWith('CREATE TABLE domain_format'))return;if(sql.startsWith('INSERT INTO state')){restored.push({schema:selected,values:args});return;}return run.call(db,sql,...args);};
  const handle=await open(file,'w');try{await writeCatalogueArchive(db,handle,tables);}finally{await handle.close();}
  const raw=await readFile(file,'utf8'),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.deepEqual(header,{format:'observanda-postgresql-archive',version:10,catalogueVersion:format,domains});
  db.version=3;db.retiredIndex=false;await readCatalogueArchive(file,db,tables);assert.equal(db.version,format);assert.deepEqual(restored,[{schema:db.schema,values:['head',payload]}]);
  for(const bad of [{...header,version:9},{...header,catalogueVersion:31},{...header,domains:domains.length?[]:['calculator']}]){
   await writeFile(file,JSON.stringify(bad)+'\n'+lines.slice(1).join('\n')+'\n');await assert.rejects(readCatalogueArchive(file,db,tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});

const reference=head=>({kind:head.kind,id:head.id,revision:head.revision});
async function ownerState(workspace){return {format:await workspace.catalogue(s=>catalogueFormat(s.db)),domains:await workspace.catalogue(readProjectDomainRegistry),settings:await workspace.catalogue(workspaceSettingsRegistry),dashboard:await readWorkspaceDashboard(workspace),website:await workspace.catalogue(s=>new WebsiteDocumentStore(s).read(null))};}
async function classify(workspace,files,expected){await workspace.catalogue(async store=>{const owner=projectSourceEvidenceOwner(store,id=>({kind:'record',recordId:id}));for(const file of files)assert.deepEqual(await owner('metadata:.observanda/materials/'+file),expected,file);});}

test('completed staged originals retain ownership through packet transfer, archive activation and fresh-key recovery',{timeout:240000},async t=>{
 const f=await collaborationFixture(t),workspace=f.author.workspace,m=new ResearchMaterials(workspace),jobs=workspaceJobs(workspace),recordId=f.book.entries[0].id,bytes=Buffer.from('Exact synthetic acquisition bytes\n'),beforeOwners=await ownerState(workspace);
 t.after(()=>jobs.worker.stop());
 const fingerprint=await fileFingerprint(bytes.length,[{size:bytes.length,sha256:digest(bytes)}],digest),files=['first.txt','second.txt'].map(name=>({name,size:bytes.length,fingerprint}));
 const batch=await m.intakes.start({recordId,title:'Portable acquisition set',provenance:'Synthetic instrument',count:files.length,bytes:files.length*bytes.length});
 await m.intakes.append({id:batch.id,offset:0,items:files});const uploaded=(await m.intakes.page({id:batch.id})).items;await m.appendImport(uploaded[0].id,0,[bytes]);
 await m.intakes.enqueue(batch.id,jobs.queue);const job=await jobs.queue.claim();assert.equal(job.id,batch.id);const prepared=await jobs.queue.definition(job).prepare(job,{});
 const staged=await m.intakes.read(batch.id),heads=await Array.fromAsync(m.headEntries({includeStaged:true})),refs=heads.map(reference);assert.equal(staged.finalization.count,files.length);assert.equal(heads.length,files.length);
 assert.equal((await m.index.page({recordId})).items.length,0);assert.deepEqual(await Array.fromAsync(m.headEntries()),[]);
 const identity=await f.sb.identity.signer.public(),scope={workspaceId:f.book.id,organizationId:f.org.id,grantId:f.grant.id,generation:f.grant.generation},live=new LiveResearch(workspace);
 assert.deepEqual(await live.dispatch(identity,scope,'evidence',{recordId}),{items:[],next:null});
 for(const ref of refs){assert.equal(await m.current(ref.id),null);await assert.rejects(m.read(ref),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(m.index.inputSet(ref),{code:'MATERIAL_INCOMPLETE'});}
 await assert.rejects(new ResearchTransfer(workspace,new Set([recordId]),[f.book.notebooks[0].id],async()=>{}).copy([],heads),{code:'COLLABORATION_DEPENDENCY'});
 const expected={kind:'record',recordId},paths=heads.flatMap(head=>['objects/'+head.id+'/head.json','objects/'+head.id+'/'+head.revision+'.json','index/items/'+head.id+'.json','index/dependencies/'+head.id+'/'+head.revision+'.json','imports/'+head.id+'/session.json','intakes/'+batch.id+'/attached/'+head.id+'.json']);
 await classify(workspace,paths,expected);
 const receiptPath='.observanda/materials/intakes/'+batch.id+'/attached/'+heads[0].id+'.json',receipt=await workspace.readMetadata(receiptPath);
 await workspace.withLock(()=>workspace.writeMetadata(receiptPath,JSON.stringify({...JSON.parse(receipt),sessionHash:'0'.repeat(64)})));
 try{await assert.rejects(classify(workspace,[receiptPath.slice('.observanda/materials/'.length)],expected),{code:'CATALOGUE_DAMAGED'});}finally{await workspace.withLock(()=>workspace.writeMetadata(receiptPath,receipt));}
 await jobs.queue.pulse(job.id,job.lease.token);const completed=await jobs.queue.complete(job.id,job.lease.token,prepared);assert.equal(completed.state,'completed');
 const segment=await m.index.segments.read(batch.id),segmentPaths=['index/batches/'+batch.id+'.json'];
 for(const owner of [null,recordId])for(const kind of [null,'artifact']){const feed=m.index.segments.feed(owner,kind);segmentPaths.push((feed.order+'/'+feed.key(segment)).slice('.observanda/materials/'.length));await classify(workspace,[feed.marker.slice('.observanda/materials/'.length)],owner?expected:{kind:'derived'});}
 await classify(workspace,segmentPaths,expected);await classify(workspace,paths,expected);
 const liveItems=(await live.dispatch(identity,scope,'evidence',{recordId})).items;assert.deepEqual(new Set(liveItems.map(item=>item.id)),new Set([batch.id,...refs.map(ref=>ref.id)]));
 const sourceDocs=await Promise.all(refs.map(ref=>m.read(ref)));for(let i=0;i<refs.length;i++){assert.equal(sourceDocs[i].content.intakeId,batch.id);assert.equal((await m.current(refs[i].id)).stagedBatch,batch.id);assert.deepEqual(await contentBuffer((await m.artifact(refs[i])).content),bytes);}
 const afterOwners=await ownerState(workspace);assert.equal(catalogueRequiresStagedEvidence(afterOwners.format),true);assert.deepEqual(capabilities(afterOwners.format),capabilities(beforeOwners.format));assert.deepEqual({...afterOwners,format:beforeOwners.format},beforeOwners);
 await m.verify();
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),parts=new ExchangeParts(workspace,offer.id);await parts.open();
 for await(const item of parts.items())assert.ok(!item.name.startsWith('.observanda/materials/intakes/'),'Local finalization receipts must not enter a packet');
 for(const ref of refs){const head=await parts.value('metadata','.observanda/materials/objects/'+ref.id+'/head.json');assert.equal(Object.hasOwn(head,'stagedBatch'),false);assert.deepEqual(reference(head),ref);}
 const incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'shared-staged-copy');await f.sb.acceptCopy(incoming.id,destination);
 const sharedVault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(sharedVault);const shared=new ResearchMaterials(new Workspace(destination,sharedVault));
 for(let i=0;i<refs.length;i++){assert.deepEqual(await shared.read(refs[i]),sourceDocs[i]);assert.equal(Object.hasOwn(await shared.current(refs[i].id),'stagedBatch'),false);assert.deepEqual(await contentBuffer((await shared.artifact(refs[i])).content),bytes);}
 assert.equal(await shared.workspace.readMetadata('.observanda/materials/intakes/'+batch.id+'/batch.json'),null);assert.deepEqual(new Set((await shared.index.page({recordId})).items.map(item=>item.id)),new Set([batch.id,...refs.map(ref=>ref.id)]));await shared.verify();
 const corrections=new EvidenceCorrections(m),retire={recordId,ref:refs[0],action:'retire',reason:'Synthetic classification qualification',metadata:null,replacementRecordId:null},review=await corrections.preview(retire);await corrections.apply({command:retire,review:review.review});
 await classify(workspace,['index/retired/'+refs[0].id+'.json'],expected);const restore={...retire,action:'restore'},restoreReview=await corrections.preview(restore);await corrections.apply({command:restore,review:restoreReview.review});await m.verify();
 const archived=await copyWorkspace(await copyPlan(workspace.root,path.join(f.directory,'staged-archive')),{vault:f.author.vault}),header=JSON.parse((await readFile(path.join(archived,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.version,10);assert.equal(header.catalogueVersion,afterOwners.format);
 const access=await createWorkspaceAccess('','Synthetic evidence recovery',f.member.deviceStore),vault=takeCreatedVault(access);f.vaults.push(vault);const rekeyed=await encryptedCopy(await copyPlan(workspace.root,path.join(f.directory,'staged-rekey')),access,vault,f.author.vault);
 for(const [root,key] of [[archived,f.author.vault],[rekeyed,vault]]){
  const restoredWorkspace=new Workspace(root,key),restored=new ResearchMaterials(restoredWorkspace);assert.deepEqual(await ownerState(restoredWorkspace),afterOwners);await restored.verify();
  for(let i=0;i<refs.length;i++){assert.deepEqual(await restored.read(refs[i]),sourceDocs[i]);assert.equal((await restored.current(refs[i].id)).stagedBatch,batch.id);assert.deepEqual(await contentBuffer((await restored.artifact(refs[i])).content),bytes);}
  await classify(restoredWorkspace,segmentPaths,expected);
 }
});
