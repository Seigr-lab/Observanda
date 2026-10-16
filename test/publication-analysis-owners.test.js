import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {publicationAnalysisState,publicationAnalysisGroups} from '../src/publication-analysis-state.js';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {clearVault} from '../src/encryption.js';
import {digest} from '../src/storage-format.js';
import {AppError} from '../src/errors.js';

test('analysis approval checks the selected database even when its record snapshot has not changed',async t=>{
 const source=await comparisonFixture(t,{groups:2}),analysis=await source.m.comparisons.save({...source.command,id:randomUUID()}),book=sampleNotebook(),host=await encryptedFixture(path.join(source.directory,'edition-owner'),book);t.after(()=>clearVault(host.vault));
 const materials=[{recordId:source.recordId,resultId:randomUUID(),label:'Chosen comparison',analysis}],hostMaterials=new ResearchMaterials(host.workspace);
 const groups=[{workspaceId:book.id,materials:[],analysis:await analysisDependencyState(hostMaterials,[])},{workspaceId:source.book.id,materials,analysis:await analysisDependencyState(source.m,materials)}];
 const snapshotId=(await source.workspace.outline()).etag,identities=new PublicationOwnerIdentities(book.id),candidate={workspaceId:book.id,reviewId:digest(randomUUID()),sourceGroups:groups,sourceSnapshots:[{workspaceId:source.book.id,snapshotId}],researchReview:{analysis:publicationAnalysisGroups(groups,identities)}};
 let allowed=true,closed=0,opened=0;
 const sourceReader=async()=>({
  async use(namespace,revision,consume,{prepare}={}){assert.equal(namespace,source.book.id);assert.equal(revision,undefined);if(!allowed)throw new AppError('ACCESS_LOCKED');opened++;await prepare?.(source.workspace);return source.workspace.catalogue(async store=>{const snapshotId=await store.head();return consume(store,await store.snapshot(snapshotId),{snapshotId,storage:source.workspace});});},
  async verify(){if(!allowed)throw new AppError('ACCESS_LOCKED');},async close(){closed++;}
 });
 const review=new AnalysisPublicationReview(host.workspace,{sourceReader});await review.assert(candidate);assert.equal(opened,1);assert.equal(closed,1);
 allowed=false;await assert.rejects(review.assert(candidate),{code:'ACCESS_LOCKED'});assert.equal(closed,2);allowed=true;
 await assert.rejects(new AnalysisPublicationReview(host.workspace).assert(candidate),{code:'ACCESS_LOCKED'});
 const previous=await source.m.read(source.dataset),columns=(await source.m.retainedSchemaPage(previous,{limit:1})).items;
 await source.m.dataset({recordId:source.recordId,title:previous.title,id:source.dataset.id,expectedRevision:source.dataset.revision,artifact:source.artifact,baseDataset:source.dataset,columnChanges:[{index:0,column:{...columns[0],unit:'ticks'}}]});
 assert.equal((await source.workspace.outline()).etag,snapshotId);await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});
 const current=await publicationAnalysisState(host.workspace,candidate,{sourceReader,requireCurrent:false});assert.equal(current.analysis.items.length,1);assert.equal(current.analysis.items[0].sourceWorkspaceId,source.book.id);assert.equal(current.analysis.items[0].recordId,identities.identity(source.book.id,'record',source.recordId));
 const reviewed={...candidate,researchReview:{analysis:current.analysis}};await review.save(reviewed,current.analysis.items.map(item=>({id:item.id,reason:'This edition retains the original analysis with its documented input interpretation.'})));await review.assert(reviewed);
 const stopped=new AbortController();stopped.abort();const reads=opened;await assert.rejects(review.assert(candidate,{signal:stopped.signal}),{name:'AbortError'});assert.equal(opened,reads);
 const calls=opened;await assert.rejects(publicationAnalysisState(host.workspace,{...candidate,sourceGroups:[groups[0],groups[1],groups[1]]},{sourceReader}),{code:'JOB_DAMAGED'});assert.equal(opened,calls);
});
