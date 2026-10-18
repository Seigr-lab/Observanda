import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pdfExportsUI} from '../src/web/pdf-exports-ui.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const settled=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('PDF exports retry the same edition, retain the selected history page and ignore replies after closing',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const previousDocument=globalThis.document,downloads=[],calls=[],notices=[];
 globalThis.document={querySelector:()=>null,createElement:()=>({click(){downloads.push(this.download);}})};
 const selected={header:{id:randomUUID()},revision:'a'.repeat(64)},oldId=randomUUID();let lost=true,complete=false,late=null,job=null;
 const older={id:oldId,documentId:selected.header.id,documentName:'Earlier report',revision:'b'.repeat(64),createdAt:1,state:'rendering',progress:{total:null,done:0},recoverable:false,error:null};
 const post=async(name,input)=>{calls.push({name,input:structuredClone(input)});
  if(name==='export-start'){job??={...older,id:input.jobId,documentName:'Observation report',revision:input.revision,state:'queued'};if(lost){lost=false;throw new Error('Reply lost');}return structuredClone(job);}
  if(name==='exports'){if(late)return late.promise;return input.after?{items:[older],next:null}:{items:job?[{...job,state:complete?'completed':job.state}]:[],next:'older'};}
  if(name==='export-download')return new Blob(['%PDF-1.7'],{type:'application/pdf'});
  if(name==='export-cancel'){job={...job,state:'cancelled',recoverable:true};return job;}
  if(name==='export-resume'){job={...job,state:'queued',recoverable:false};return job;}
  throw new Error(name);
 };
 const ui=pdfExportsUI({post,esc:String,draw:()=>{},getDocument:()=>selected,notify:message=>notices.push(message)});
 try{
  await assert.rejects(ui.start(),/Reply lost/);complete=true;await ui.start();
  const starts=calls.filter(call=>call.name==='export-start');assert.equal(starts.length,2);assert.deepEqual(starts[0].input,starts[1].input);assert.deepEqual(downloads,['Observation report.pdf']);
  complete=false;await ui.action('exports-more',{});assert.match(ui.view(),/Earlier report/);assert.doesNotMatch(ui.view(),/Observation report/);
  t.mock.timers.tick(1000);await settled();assert.equal(calls.at(-1).input.after,'older');assert.match(ui.view(),/Earlier report/);
  await ui.action('exports-previous',{});await ui.action('export-cancel',{dataset:{id:job.id}});assert.match(ui.view(),/Cancelled/);
  await ui.action('export-resume',{dataset:{id:job.id}});assert.equal(job.state,'queued');
  late=deferred();t.mock.timers.tick(1000);await settled();ui.deactivate();late.resolve({items:[{...job,state:'completed'}],next:null});await settled();assert.equal(ui.view(),'');assert.equal(downloads.length,1);assert.deepEqual(notices,[]);
 }finally{ui.dispose();globalThis.document=previousDocument;}
});
