import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {publicationSourceFactory} from '../src/project-publication-sources.js';
import {PublicationSourceAccess} from '../src/publication-source-access.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {AnalysisPublicationReviewJobs} from '../src/analysis-publication-review-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';

async function run(jobs,id){jobs.worker.enabled=true;try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}return jobs.queue.read(id);}

test('named website retains seven lab-book analysis decisions through source access renewal',{timeout:180000},async t=>{
 let application,jobs;t.after(async()=>{await jobs?.worker.stop();await application?.close();});
 const f=await projectTreeFixture(t),entry=f.books[0],storage=new LabBookStorage(entry.root,entry.labBookId,entry.key),materials=new ResearchMaterials(storage),source=await storage.read(),record=source.book.entries[0];
 await new LabBookDirectory(f.registry).register(entry.projectId,entry);
 const pin=await materials.pinRecord(record.id,recordRevision(record)),analyses=[];
 for(let index=0;index<7;index++)analyses.push(await materials.analysis({recordId:record.id,title:'Historical interpretation '+index,tool:'Synthetic interpretation',version:'1',parameters:'Retained source observation',inputs:[pin],outputs:[]}));
 const updated={...record,share:true,body:'Current observation with historical interpretations',results:{version:1,statements:analyses.map((analysis,index)=>({id:randomUUID(),kind:'conclusion',basis:'retained',title:'Interpretation '+index,text:'Retained interpretation '+index,limitations:'Synthetic qualification only.',source:analysis}))}};
 await new ResearchRecords(storage,{}).save({workspaceId:source.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:updated}]});
 const client={},unlock=async()=>{
  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});await application.unlock(client,entry.projectId,{password:''});
  await application.run(client,projectRequest('/api/projects/'+entry.projectId+'/lab-books/'+entry.labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
  return publicationSourceFactory(application,client,f.workspace);
 };
 let sourceReader=await unlock();const host=(await f.workspace.outline()).metadata,sites=new WebsiteSites(f.workspace),created=await sites.change({workspaceId:host.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Independent observations'}),current=await sites.read(created.id);
 await sites.save(created.id,{workspaceId:host.id,baseEtag:current.etag,websitePin:current.websitePin,metadata:{website:{...current.book.website,researchSources:[{workspaceId:source.book.id,projectIds:[entry.projectId],selection:{defaultShare:false,includeProjects:[entry.projectId],records:[{id:record.id,share:true,attachments:[]}]}}]}},projects:[],changes:[],removed:[],selection:current.site.selection});
 const workspace=websiteWorkspace(f.workspace,created.id),grants=new PublicationSourceAccess();jobs=workspaceJobs(f.workspace,undefined,{sourceAccess:grants});
 const diagnose=()=>{const release=jobs.queue.release.bind(jobs.queue);t.mock.method(jobs.queue,'release',async(id,token,options)=>{if(options?.error)t.diagnostic(options.error.stack);return release(id,token,options);});};diagnose();
 let queue=websiteJobQueue(jobs.queue,created.id),releases=new PublicationJobs(workspace,{sourceReader,sourceAccess:grants});
 const admitted=await releases.start(await workspace.outline(),queue),prepared=await run(jobs,admitted.id);assert.equal(prepared.state,'completed',prepared.error);
 const candidate=await releases.read(prepared.result.id),review=new AnalysisPublicationReview(workspace,{sourceReader}),window=await review.window(candidate,{limit:32});assert.equal(window.total,7);assert.equal(window.decided,0);
 await review.fresh(candidate);
 const decisions=window.items.map((row,index)=>({id:row.id,reason:'Retain historical interpretation '+index+' and its limitations.'})),command={id:candidate.reviewId,commandId:randomUUID(),decisions},operations=new AnalysisPublicationReviewJobs(workspace,undefined,{sourceReader,sourceAccess:grants});
 const request=await operations.start(command,queue);assert.equal(request.state,'queued');grants.clear();await application.close();application=null;
 jobs=workspaceJobs(f.workspace,undefined,{sourceAccess:grants});diagnose();queue=websiteJobQueue(jobs.queue,created.id);
 const failed=await run(jobs,request.id);assert.equal(failed.error,'ACCESS_LOCKED');assert.deepEqual(failed.input.request.decisions,decisions);
 sourceReader=await unlock();const resumed=new AnalysisPublicationReviewJobs(workspace,undefined,{sourceReader,sourceAccess:grants});await resumed.control(queue,request.id,'retry');
 const saved=await run(jobs,request.id);assert.equal(saved.state,'completed',saved.error);assert.deepEqual(saved.result.decisions,decisions);assert.equal(saved.result.decided,7);
 const reread=new AnalysisPublicationReview(workspace,{sourceReader});await reread.assert(candidate);assert.equal((await reread.window(candidate,{limit:32})).decided,7);assert.equal((await resumed.start(command,queue)).id,request.id);
 await materials.analysis({id:analyses[0].id,expectedRevision:analyses[0].revision,recordId:record.id,title:'Revised interpretation',tool:'Synthetic interpretation',version:'2',parameters:'Changed after the edition review',inputs:[pin],outputs:[]});
 await assert.rejects(reread.assert(candidate),{code:'ANALYSIS_REVIEW'});
});
