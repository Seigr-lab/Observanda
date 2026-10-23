import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace,workspaceFile,digest} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {ResearchCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {catalogueFormat,catalogueRequiresPagedResearchTables} from '../src/catalogue-format.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {revisionText} from '../src/web/revision-model.js';
import {retainedTable,retainedTablePage,retainedTableCell} from '../src/retained-tables.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {contentBuffer} from '../src/file-content.js';
import {CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {catalogueBinding} from '../src/postgres-activation.js';

const statement=(source,table,title)=>({id:randomUUID(),kind:'table',basis:'retained',source,title,text:'Exact retained synthetic readings.',limitations:'Synthetic qualification only.',table});
const flag=owner=>owner.catalogue(async store=>catalogueRequiresPagedResearchTables(await catalogueFormat(store.db)));
async function artifact(materials,recordId,name,text){const bytes=Buffer.from(text),upload=await materials.startImport({recordId,name,size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);return materials.finishImport(upload.id);}
async function legacyDataset(materials,recordId){
 const source=await artifact(materials,recordId,'legacy.csv','State,Reading\nA,0001.2300\nB,10000000000000001'),columns=[defaultColumn({label:'State'}),defaultColumn({label:'Reading'})],rows=[['A','0001.2300'],['B','10000000000000001']].map((cells,i)=>({id:source.id+':'+(i+2),line:i+2,cells,excluded:null,order:i+1,locator:{format:'delimited',line:i+2}})),hash=digest(revisionText(rows)),save=fn=>materials.workspace.withLock(fn),pages=materials.sequences.builder('pages',save),schema=materials.sequences.builder('columns',save);
 await save(()=>materials.put(materials.metadataFile('tables/'+hash+'.json'),rows));await pages.append({hash,count:rows.length});for(const column of columns)await schema.append(column);
 const content={datasetFormat:2,inputs:[source],schemaIndex:await schema.finish(),pageIndex:await pages.finish(),rowCount:2,sourceMapping:{format:'delimited',delimiter:',',header:true},delimiter:',',encoding:'UTF-8',order:'acquisition'};
 return save(()=>materials.commit({kind:'dataset',recordId,title:'Legacy readings',content}));
}

test('paged result tables retain complete frozen publication and exact selected values through archive and fresh-key recovery',{timeout:300000},async t=>{
 const stage=message=>{t.diagnostic(message);process.stderr.write('[retained-table] '+message+'\n');};
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-paged-tables-')),vaults=[],runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);let fixture;
 t.after(async()=>{await runtime.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-paged-tables-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook();book.entries=[{...book.entries[0],share:true,body:'Synthetic paged table result.',attachments:[],figures:[],sections:[],relations:[]}];
 fixture=await encryptedFixture(directory,book);stage('Disposable native owner opened.');vaults.push(fixture.vault);const {workspace,vault}=fixture,materials=new ResearchMaterials(workspace),recordId=book.entries[0].id,values=new RecordValues(workspace),target=id=>({workspaceId:book.id,recordId,field:'result:'+id}),save=async item=>{const selected=await values.read(target(item.id));return values.save({...target(item.id),expectedRevision:selected.revision,value:{value:item}});};
 const legacy=await legacyDataset(materials,recordId),selection={columns:[0,1],offset:0,count:2,includeExcluded:false},v1=await retainedTable(materials,{ref:legacy,selection,version:1}),v2=await retainedTable(materials,{ref:legacy,selection,version:2});assert.equal(v1.rows[0].cells[1],'0001.2300');assert.equal(v2.rows[1].cells[1],'10000000000000001');assert.equal(await flag(workspace),false);
 const pinned=await retainedTable(materials,{ref:legacy,selection:{...selection,count:null},version:3}),item=statement(legacy,pinned,'Pinned legacy source'),base=await values.read(target(item.id)),finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){const result=await finish.apply(this,args);if(this.workspace.root===workspace.root)throw Error('Interrupted table save');return result;});
 await assert.rejects(values.save({...target(item.id),expectedRevision:base.revision,value:{value:item}}),/Interrupted table save/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal(await flag(workspace),false);assert.equal((await values.read(target(item.id))).value.value,null);
 const draftCommand={id:randomUUID(),workspaceId:book.id,recordId,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value:item}},draft=await new RecordValueDrafts(workspace).write(draftCommand);assert.equal(await flag(workspace),true);
 await save(item);await save(statement(legacy,v1,'Legacy table one'));await save(statement(legacy,v2,'Legacy table two'));stage('Legacy v1/v2 and query v3 admission, interrupted save rollback and pending draft passed.');
 const total=1005,exact='10000000000000001.'+'1234567890'.repeat(1600),last='LAST_COMPLETE_ROW_'+String(total-1),csv=['Label,Exact,Private',...Array.from({length:total},(_,i)=>(i===total-1?last:'row-'+i+'-'+('x'.repeat(300)))+','+(i===total-1?exact:'0001.2300')+',PRIVATE_TABLE_SENTINEL')].join('\n'),input=await artifact(materials,recordId,'complete.csv',csv),source=await materials.dataset({recordId,title:'Complete query dataset',artifact:input,columns:['Label','Exact','Private'].map(label=>defaultColumn({label}))},{signal:t.signal}),table=await retainedTable(materials,{ref:source,selection:{columns:[0,1],offset:0,count:null,includeExcluded:false},version:3}),large=statement(source,table,'Complete selected table');
 stage('Prepared complete indexed 1005-row dataset.');assert.ok(JSON.stringify(table).length<200);await save(large);const late=await retainedTablePage(materials,{ref:source,table,offset:1004},{signal:t.signal});assert.equal(late.table.rows[0].cells[0],last);assert.equal(late.table.rows[0].cellWindows[1].total,exact.length);let received='',offset=0;
 do{const page=await retainedTableCell(materials,{ref:source,table,rowOffset:1004,cursor:late.table.rows[0].cursor,columnOffset:1,offset},{signal:t.signal});received+=page.value;offset=page.next;}while(offset!==null);assert.equal(received,exact);
 const releases=new PublicationJobs(workspace),outline=await releases.workspace.currentOutline(),command={etag:outline.etag,websitePin:outline.websitePin},capture=await withPublicationCapture(releases.workspace,async(captured,id,commit)=>{const pinned=await releases.pin(command,{workspace:captured,id,signal:t.signal});return commit(()=>pinned);},{signal:t.signal}),retained=await openPublicationInput(releases.workspace,capture);await retained.verify();assert.ok(retained.document.count('retainedTables')>64);stage('Complete 1005-row selected table captured across bounded native chunks.');
 const prior=await materials.read(source);await workspace.withLock(()=>materials.commit({kind:'dataset',recordId,id:source.id,expectedRevision:source.revision,title:'Later independently saved source',content:prior.content}));assert.notEqual((await materials.current(source.id)).revision,source.revision);
 const originalPage=ResearchMaterials.prototype.retainedDatasetPage;t.mock.method(ResearchMaterials.prototype,'retainedDatasetPage',()=>{throw Error('Rendering fetched live dataset cells');});
 const job={id:capture.id,lease:{token:randomUUID()}},signal=t.signal;let candidate;
 try{candidate=await releases.prepare(job,{signal,progress:async()=>{}});await workspace.withLock(()=>releases.commit(job,candidate));}finally{ResearchMaterials.prototype.retainedDatasetPage.mock.restore();assert.equal(ResearchMaterials.prototype.retainedDatasetPage,originalPage);}
 const output=await releases.read(capture.reviewId),html=(await contentBuffer(await output.files.get('entries/'+recordId+'.html'))).toString();assert.ok(Buffer.byteLength(html)>262144);assert.ok(html.includes(last));assert.ok(html.includes(exact));assert.ok(html.includes('0001.2300'));assert.ok(!html.includes('PRIVATE_TABLE_SENTINEL'));assert.ok(!html.includes(source.id));const outputHash=digest(html);stage('Rendered complete frozen table without reopening dataset cells after its source revision changed.');
 const descriptor=JSON.parse(await workspace.readFile(await workspaceFile(workspace.root),'utf8')),archiveRoot=await copyWorkspace(await copyPlan(workspace.root,path.join(directory,'archive'),{vault,onProgress:()=>t.signal.throwIfAborted()}),{vault,onProgress:()=>t.signal.throwIfAborted()});
 assert.equal(await catalogueBinding(archiveRoot),null);assert.equal(JSON.parse((await readFile(path.join(archiveRoot,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]).catalogueVersion,await workspace.catalogue(store=>catalogueFormat(store.db)));stage('Complete owner exported with archive-only database and retained evidence/output files.');
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(directory,'new-device')})),freshVault=takeCreatedVault(access);vaults.push(freshVault);const recoveredRoot=await encryptedCopy(await copyPlan(archiveRoot,path.join(directory,'fresh-key'),{vault,onProgress:()=>t.signal.throwIfAborted()}),access,freshVault,vault,{onProgress:()=>t.signal.throwIfAborted()}),recovered=new Workspace(recoveredRoot,freshVault);stage('Fresh-key owner restored from the complete archive.');
 async function check(owner){
  assert.equal(await flag(owner),true);const m=new ResearchMaterials(owner),current=new RecordValues(owner);assert.deepEqual((await current.read(target(large.id))).value.value,large);assert.deepEqual((await current.read(target(item.id))).value.value,item);assert.deepEqual((await new RecordValueDrafts(owner).read({workspaceId:book.id,id:draftCommand.id,expectedRevision:draft.revision})).value,draftCommand.value);
  assert.deepEqual(await retainedTable(m,{ref:legacy,selection,version:1}),v1);assert.deepEqual(await retainedTable(m,{ref:legacy,selection,version:2}),v2);assert.equal((await retainedTablePage(m,{ref:source,table,offset:1004})).table.rows[0].cells[0],last);
  const jobs=new PublicationJobs(owner),saved=await jobs.source(capture.id);await (await openPublicationInput(jobs.workspace,saved)).verify();const publication=await jobs.read(capture.reviewId);assert.equal(digest((await contentBuffer(await publication.files.get('entries/'+recordId+'.html'))).toString()),outputHash);await verifyCatalogueArchive(owner,descriptor);
 }
 await check(recovered);await check(new Workspace(archiveRoot,vault));stage('Ordinary archive activation and fresh-key archive recovery preserved table queries, drafts, exact cells and complete frozen publication.');
});
