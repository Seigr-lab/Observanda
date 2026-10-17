import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';
import {createComparisonInputReader} from '../src/comparison-input-reader.js';
import {addressedComparisonInputs} from '../src/web/analysis-model.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {publicationDependencyState} from '../src/publication-analysis-inputs.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {WebsiteSites} from '../src/website-sites.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {contentBuffer} from '../src/file-content.js';
import {AppError} from '../src/errors.js';
async function publicationCommand(releases){const {etag,websitePin}=await releases.workspace.outline();return {etag,websitePin};}

function authorizedSources(host,foreign){
 let allowed=true,opened=0,closed=0,foreignReads=0;
 const sourceReader=async()=>{throw Error('Private comparison inputs are not selected publication content');};
 sourceReader.materialAccess=({workspace=host.workspace,signal}={})=>{
  opened++;let finished=false;
  const check=()=>{signal?.throwIfAborted();assert.equal(finished,false);if(!allowed)throw new AppError('ACCESS_LOCKED');};
  return {
   async use(ref,consume){
    check();let storage=workspace;
    if(ref.workspaceId!==host.book.id){
     assert.equal(ref.workspaceId,foreign.book.id);foreignReads++;
     storage=new Proxy(foreign.workspace,{get(target,key){
      if(['withLock','writeMetadata','removeMetadata'].includes(key))return ()=>{throw Error('Publication wrote a private input owner');};
      const value=target[key];return typeof value==='function'?value.bind(target):value;
     }});
    }
    const result=await consume(storage,ref);check();return result;
   },async verify(){check();},async close(){assert.equal(finished,false);finished=true;closed++;}
  };
 };
 return {sourceReader,deny(){allowed=false;},allow(){allowed=true;},stats:()=>({opened,closed,foreignReads})};
}

test('adding authorized dependency readers preserves existing local edition fingerprints',async t=>{
 const host=await comparisonFixture(t,{groups:2}),analysis=await host.m.comparisons.save(host.command),access=authorizedSources(host);
 const sources=[{recordId:host.recordId,resultId:randomUUID(),label:'Local conclusion',analysis}];
 const expected=await analysisDependencyState(host.m,sources);
 assert.deepEqual(await publicationDependencyState(host.m,sources,{sourceReader:access.sourceReader}),expected);
 assert.deepEqual(access.stats(),{opened:1,closed:1,foreignReads:0});
 const stopped=new AbortController();stopped.abort();
 await assert.rejects(publicationDependencyState(host.m,sources,{sourceReader:access.sourceReader,signal:stopped.signal}),{name:'AbortError'});
 assert.equal(access.stats().opened,1);
});

test('published comparison conclusions check private foreign inputs without exporting them',async t=>{
 const host=await comparisonFixture(t,{groups:2}),foreign=await comparisonFixture(t,{groups:2}),access=authorizedSources(host,foreign);
 const command={...host.command,...addressedComparisonInputs(foreign.command,foreign.book.id)};
 const inputs=createComparisonInputReader(host.m,{workspaceId:host.book.id,access:access.sourceReader.materialAccess()});
 let analysis;try{analysis=await new AnalysisComparisons(host.m,{inputs}).save(command);}finally{await inputs.close();}
 const conclusion=host.book.entries[2],result={id:randomUUID(),kind:'conclusion',title:'Selected conclusion',text:'Four retained readings matched and two differed.',basis:'retained',source:{...analysis,label:'PRIVATE_COMPARISON_LABEL'},limitations:'Synthetic qualification only.'};
 await new ResearchRecords(host.workspace,{}).save({workspaceId:host.book.id,changes:[{id:conclusion.id,expectedRevision:recordRevision(conclusion),record:{...conclusion,share:true,results:{version:1,statements:[result]}}}]},{compact:true});
 // The independent website owns its publication consent for this previously private record.
 const sites=new WebsiteSites(host.workspace),site=await sites.read(null),selection=structuredClone(site.site.selection);selection.records=selection.records.filter(row=>row.id!==conclusion.id);selection.records.push({id:conclusion.id,share:true,attachments:[]});
 await sites.save(null,{workspaceId:host.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection});
 const sourceSnapshot=(await foreign.workspace.outline()).etag,releases=new PublicationJobs(host.workspace,{sourceReader:access.sourceReader});
 const candidate=await releases.inline(await publicationCommand(releases)),review=new AnalysisPublicationReview(host.workspace,{sourceReader:access.sourceReader});
 assert.equal(candidate.researchReview.analysis.count,0);await review.assert(candidate);
 const entry=await candidate.files.get('entries/'+conclusion.id+'.html');assert.ok(entry,'The selected conclusion must have a retained page');const html=await contentBuffer(entry);
 assert.ok(html.includes(Buffer.from(result.text)));
 for await(const [name,content] of candidate.files){
  const bytes=await contentBuffer(content);
  for(const privateValue of ['PRIVATE_COMPARISON_LABEL',foreign.book.id,foreign.dataset.id,foreign.artifact.id])assert.ok(!bytes.includes(Buffer.from(privateValue)),name+': '+privateValue);
 }
 assert.ok(!html.includes(Buffer.from('9007199254740993')));
 assert.equal((await foreign.workspace.outline()).etag,sourceSnapshot);
 assert.ok(access.stats().foreignReads>0);assert.equal(access.stats().opened,access.stats().closed);
 access.deny();await assert.rejects(review.assert(candidate),{code:'ACCESS_LOCKED'});assert.equal(access.stats().opened,access.stats().closed);access.allow();
 const dataset=await foreign.m.read(foreign.dataset),column=(await foreign.m.datasetColumns(dataset))[0];
 await foreign.m.dataset({recordId:foreign.recordId,title:dataset.title,id:foreign.dataset.id,expectedRevision:foreign.dataset.revision,artifact:foreign.artifact,baseDataset:foreign.dataset,columnChanges:[{index:0,column:{...column,unit:'ticks'}}]});
 assert.equal((await foreign.workspace.outline()).etag,sourceSnapshot);
 await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});
 const next=await releases.inline(await publicationCommand(releases));
 assert.equal(next.researchReview.analysis.count,1);const changed=await review.window(next,{limit:4});assert.equal(changed.total,1);assert.equal(changed.items.length,1);
 assert.ok(changed.items[0].sample.some(ref=>ref.workspaceId===foreign.book.id&&ref.id===foreign.dataset.id));
 await assert.rejects(review.assert(next),{code:'ANALYSIS_REVIEW'});
 await review.save(next,changed.items.map(item=>({id:item.id,reason:'The conclusion reports the original retained input interpretation.'})));await review.assert(next);
 assert.equal(access.stats().opened,access.stats().closed);
 assert.deepEqual((await host.m.read(analysis)).content.comparison,command.comparison);
});
