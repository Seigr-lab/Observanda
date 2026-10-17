import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {catalogueFormat,catalogueRequiresPublicationDocuments} from '../src/catalogue-format.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {publicationDependencyState} from '../src/publication-analysis-inputs.js';
import {createComparisonInputReader} from '../src/comparison-input-reader.js';
import {createPublicationInput,publicationInputState,finishPublicationInput} from '../src/publication-input-reader.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {PublicationDocumentBuilder} from '../src/publication-document.js';
import {publicationReviewOwner,publicationAnalysisReader} from '../src/publication-retained-input.js';
import {PublicationRollback,verifyRetainedPublicationRollback} from '../src/publication-rollback.js';
import {publicationAnalysisState} from '../src/publication-analysis-state.js';
import {analysisEditionReviewView,requireAnalysisEditionReview} from '../src/web/analysis-review-ui.js';
import {digest} from '../src/storage-format.js';
async function changed(t){
 const f=await comparisonFixture(t,{groups:2}),analysis=await f.m.comparisons.save(f.command),previous=await f.m.read(f.dataset),column=(await f.m.retainedSchemaPage(previous,{limit:1})).items[0];
 await f.m.dataset({recordId:f.recordId,title:previous.title,id:f.dataset.id,expectedRevision:f.dataset.revision,artifact:f.artifact,baseDataset:f.dataset,columnChanges:[{index:0,column:{...column,unit:'ticks'}}]});
 return {...f,analysis};
}
const stream=async function*(rows){for(const row of rows)yield row;};
const format=workspace=>workspace.catalogue(store=>catalogueFormat(store.db));

test('streamed dependency sources preserve exact local and routed fingerprints and changed rows',async t=>{
 const f=await changed(t),sources=Array.from({length:9},(_,i)=>({recordId:f.recordId,resultId:randomUUID(),label:'Conclusion '+i,analysis:f.analysis})),expected=await analysisDependencyState(f.m,sources),items=[];
 const streamed=await publicationDependencyState(f.m,stream(sources),{onItem:async item=>{items.push(item);}});assert.deepEqual(streamed,{fingerprint:expected.fingerprint,count:expected.items.length});assert.deepEqual(items,expected.items);
 const routed=createComparisonInputReader(f.m,{workspaceId:f.book.id}),routedItems=[];
 try{const actual=await analysisDependencyState(f.m,stream(sources),{inputs:routed,onItem:item=>{routedItems.push(item);}});assert.deepEqual(actual,streamed);assert.deepEqual(routedItems,expected.items);}finally{await routed.close();}
 const unused=async()=>{throw Error('Unused source reader');};unused.materialAccess=()=>{throw Error('Empty analysis must not ask for private input access');};assert.deepEqual(await publicationDependencyState(f.m,stream([]),{sourceReader:unused,onItem:()=>assert.fail('No changed input')}),{fingerprint:digest(''),count:0});
 const abort=new AbortController();await assert.rejects(publicationDependencyState(f.m,stream(sources),{signal:abort.signal,onItem:()=>abort.abort()}),{name:'AbortError'});
});

test('native analysis approval requires every retained decision across pages and rejects changed or forged dependencies',async t=>{
 const f=await changed(t),sources=Array.from({length:9},(_,i)=>({recordId:f.recordId,resultId:randomUUID(),label:'Conclusion '+i,analysis:f.analysis})),jobId=randomUUID(),input=createPublicationInput(f.workspace,jobId,f.book),{builder}=publicationInputState(input);
 await f.workspace.withLock(()=>builder.append('records',f.recordId,{id:f.recordId,title:'Retained record title'}));
 await f.workspace.withLock(async()=>{for(let i=0;i<sources.length;i++)await builder.append('sourceMaterials',String(i),{workspaceId:f.book.id,source:sources[i]},{indexes:{owner:f.book.id+'/'+String(i).padStart(16,'0')}});});
 const analysis=await publicationDependencyState(f.m,stream(sources),{onItem:item=>f.workspace.withLock(()=>builder.append('analysisItems',item.id,item,{indexes:{owner:f.book.id+'/'+item.id}}))});
 await f.workspace.withLock(()=>builder.append('sourceGroups',f.book.id,{workspaceId:f.book.id,snapshotId:null,analysis}));
 const summary={projects:0,notebooks:0,records:1,pages:0,media:0},researchReview={retainedFigures:0,changedInputs:0,editedFigures:0,analysis,references:{count:0,records:0}},source=await f.workspace.withLock(()=>finishPublicationInput(input,{hasSources:false,researchReview,summary})),candidate={version:3,id:digest('retained output'),workspaceId:f.book.id,websiteId:null,jobId,attempt:randomUUID(),reviewId:digest(jobId),source:{jobId,document:source.document},hasSources:false,researchReview,summary},review=new AnalysisPublicationReview(f.workspace);
 assert.equal(analysis.count,9);await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});const status=await review.status(candidate);assert.equal(status.reviewed,false);assert.equal(status.window.items.length,4);assert.equal(status.window.items[0].recordTitle,'Retained record title');
 const beforeFormat=await format(f.workspace),firstDecision={id:status.window.items[0].id,reason:'Retained interpretation'},prefix='.observanda/release-outputs/'+candidate.jobId+'/'+candidate.attempt;
 const metadataWrite=f.workspace.writeMetadata.bind(f.workspace);let attempted=0;
 t.mock.method(f.workspace,'writeMetadata',async(name,text)=>{if(name.startsWith(prefix+'/')){attempted++;assert.equal(catalogueRequiresPublicationDocuments(await format(f.workspace)),true,'native capability precedes every decision node');}if(name===review.file(candidate.reviewId))throw Error('Interrupted decision receipt');return metadataWrite(name,text);});
 await assert.rejects(review.save(candidate,[firstDecision]),/Interrupted decision receipt/);f.workspace.writeMetadata.mock.restore();assert.ok(attempted>0);assert.equal(await review.read(candidate),null);assert.deepEqual(await Array.fromAsync(f.workspace.metadataNames(prefix)),[]);assert.equal(await format(f.workspace),beforeFormat,'failed receipt rolls back capability admission too');
 const cancelled=new AbortController();t.mock.method(f.workspace,'writeMetadata',async(name,text)=>{const result=await metadataWrite(name,text);if(name.startsWith(prefix+'/'))cancelled.abort();return result;});
 await assert.rejects(review.save(candidate,[firstDecision],{signal:cancelled.signal}),{name:'AbortError'});f.workspace.writeMetadata.mock.restore();assert.equal(await review.read(candidate),null);assert.deepEqual(await Array.fromAsync(f.workspace.metadataNames(prefix)),[]);assert.equal(await format(f.workspace),beforeFormat);
 const all=[];for(let offset=0;offset<9;offset+=4){const page=await review.window(candidate,{offset}),decisions=page.items.map(item=>({id:item.id,reason:'Retain the original interpretation for '+item.label}));all.push(...decisions);const saved=await review.save(candidate,decisions);assert.equal(saved.decided,Math.min(9,offset+4));assert.equal(saved.reviewed,offset===8);}
 await review.assert(candidate);assert.equal((await review.verify(candidate)).reviewed,true);assert.equal((await review.window(candidate,{offset:4})).items[0].decision.reason,all[4].reason);
 await assert.rejects(review.save(candidate,[{id:digest('unrelated'),reason:'Forged decision'}]),{code:'ANALYSIS_REVIEW'});
 const original=await review.read(candidate),owner=publicationReviewOwner(candidate),forged=new PublicationDocumentBuilder(f.workspace,{owner,collections:{decisions:{indexes:[]}}});
 await f.workspace.withLock(async()=>{for(const decision of all.slice(0,-1))await forged.append('decisions',decision.id,decision);await forged.append('decisions',digest('not-an-expected-item'),{id:digest('not-an-expected-item'),reason:'Unrelated'});});
 const document=await f.workspace.withLock(()=>forged.finish({header:{version:1,reviewId:candidate.reviewId,fingerprint:analysis.fingerprint,count:analysis.count}}));await f.workspace.withLock(()=>f.workspace.writeMetadata(review.file(candidate.reviewId),JSON.stringify({...original,document})));await assert.rejects(review.verify(candidate),{code:'CATALOGUE_DAMAGED'});await f.workspace.withLock(()=>f.workspace.writeMetadata(review.file(candidate.reviewId),JSON.stringify(original)));
 const datasetHead=await f.m.current(f.dataset.id),dataset=await f.m.read({...f.dataset,revision:datasetHead.revision}),column=(await f.m.retainedSchemaPage(dataset,{limit:1})).items[0];await f.m.dataset({recordId:f.recordId,title:dataset.title,id:f.dataset.id,expectedRevision:datasetHead.revision,artifact:f.artifact,baseDataset:{...f.dataset,revision:datasetHead.revision},columnChanges:[{index:0,column:{...column,unit:'seconds'}}]});await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});
 // Rollback's new dependency rows are separately pinned in the same output
 // owner; the original candidate's recorded analysis stays unchanged.
 const rolled=new PublicationDocumentBuilder(f.workspace,{owner,collections:{analysisItems:{indexes:[]}}}),current=await publicationAnalysisState(f.workspace,candidate,{requireCurrent:false,onItem:item=>f.workspace.withLock(()=>rolled.append('analysisItems',item.id,item))}),analysisDocument=await f.workspace.withLock(()=>rolled.finish({header:{version:1,analysis:current.analysis}})),projected=PublicationRollback.prototype.project(candidate,{id:randomUUID(),...current,analysisDocument});
 assert.notEqual(current.analysis.fingerprint,candidate.researchReview.analysis.fingerprint);assert.equal((await publicationAnalysisReader(f.workspace,projected)).count,9);await assert.rejects(review.assert(projected),{code:'ANALYSIS_REVIEW'});assert.equal((await review.verify(candidate)).reviewed,true,'old decision root remains intact although current inputs are stale');
 const rollback={version:3,id:randomUUID(),workspaceId:f.book.id,workspaceEtag:'b'.repeat(64),websitePin:{researchSnapshotId:'b'.repeat(64),websiteId:null,websiteRevision:null},reviewId:candidate.reviewId,releaseId:candidate.id,configEtag:digest('configuration'),destinationKey:digest('destination'),createdAt:new Date().toISOString(),previous:null,...current,analysisDocument};
 const offline=new Proxy(f.workspace,{get(target,key){if(['currentOutline','outline'].includes(key))return ()=>assert.fail('Retained verification consulted current state');const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await verifyRetainedPublicationRollback(offline,candidate,rollback)).reviewed,false,'unreviewed rollback roots are valid retained state');
 await assert.rejects(verifyRetainedPublicationRollback(offline,candidate,{...rollback,analysis:{...rollback.analysis,count:10}}),{code:'JOB_DAMAGED'});
 const damaged=new PublicationDocumentBuilder(f.workspace,{owner,collections:{analysisItems:{indexes:[]}}});const rows=await publicationAnalysisReader(f.workspace,projected);await f.workspace.withLock(async()=>{for await(const item of rows.items())await damaged.append('analysisItems',item.id,{...item,id:digest('wrong identity')});});
 const damagedRoot=await f.workspace.withLock(()=>damaged.finish({header:{version:1,analysis:current.analysis}}));await assert.rejects(verifyRetainedPublicationRollback(offline,candidate,{...rollback,analysisDocument:damagedRoot}),{code:'JOB_DAMAGED'});

});


test('native analysis decisions survive archive and fresh-key copies without current source access',async t=>{
 const f=await changed(t),current=await f.workspace.read(),record=current.book.entries.find(row=>row.id===f.recordId);
 record.share=true;record.results={version:1,statements:Array.from({length:5},(_,index)=>({id:randomUUID(),kind:'conclusion',title:'Retained conclusion '+index,text:'Interpretation of the original retained readings.',basis:'retained',source:f.analysis,limitations:'Synthetic qualification only.'}))};
 await f.workspace.save(current.book,current.etag);
 const releases=new PublicationJobs(f.workspace),source=await releases.workspace.outline(),candidate=await releases.inline({etag:source.etag,websitePin:source.websitePin}),review=new AnalysisPublicationReview(f.workspace);
 assert.equal(candidate.version,3);assert.equal(candidate.researchReview.analysis.count,5);assert.equal(catalogueRequiresPublicationDocuments(await format(f.workspace)),true);
 for(let offset=0;offset<5;offset+=4){const page=await review.window(candidate,{offset});await review.save(candidate,page.items.map(item=>({id:item.id,reason:'This edition reports the retained original interpretation.'})));}
 const receipt=await review.read(candidate);assert.equal((await review.verify(candidate)).reviewed,true);
 const archived=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'archive')),{vault:f.vault}),archiveHeader=JSON.parse((await readFile(path.join(archived,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);
 assert.equal(catalogueRequiresPublicationDocuments(archiveHeader.catalogueVersion),true);
 const access=await createWorkspaceAccess('','Synthetic retained analysis recovery',f.deviceStore),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const rekeyed=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh-key')),access,vault,f.vault),unavailable=()=>assert.fail('Retained analysis verification consulted a live source');
 for(const [directory,key] of [[archived,f.vault],[rekeyed,vault]]){
  const restored=new Workspace(directory,key),offline=new Proxy(restored,{get(target,name){if(['outline','currentOutline','read'].includes(name))return unavailable;const value=target[name];return typeof value==='function'?value.bind(target):value;}}),jobs=new PublicationJobs(offline),retained=await jobs.stored(candidate.reviewId),decisions=new AnalysisPublicationReview(offline,{sourceReader:unavailable});
  assert.equal(await format(restored),await format(f.workspace));assert.deepEqual(await decisions.read(retained),receipt);assert.deepEqual(await decisions.verify(retained),{reviewed:true,decided:5,total:5,decisions:[]});
  const page=await decisions.window(retained,{offset:4});assert.equal(page.items.length,1);assert.equal(page.items[0].decision.reason,'This edition reports the retained original interpretation.');
 }
});

test('review UI uses scalar counts and selected rows without aggregate entry descriptors',()=>{
 const item={id:digest('item'),recordId:randomUUID(),recordTitle:'Selected retained title',label:'Result',changed:1,sample:[],decision:null},preview={researchReview:{analysis:{fingerprint:digest('state'),count:37}},analysisReview:{reviewed:false,decided:0,window:{items:[item],total:37,offset:0,next:'cursor',decided:0}}};
 assert.throws(()=>requireAnalysisEditionReview(preview));const html=analysisEditionReviewView(preview,{esc:String,field:(label,control)=>label+control});assert.ok(html.includes('Selected retained title'));assert.ok(html.includes('analysis-review-next'));assert.ok(html.includes('data-offset="1"'));assert.ok(html.includes('Reviewed 0 of 37'));
 requireAnalysisEditionReview({...preview,analysisReview:{reviewed:true}});assert.throws(()=>requireAnalysisEditionReview({researchReview:{analysis:{count:1}}}));
});
