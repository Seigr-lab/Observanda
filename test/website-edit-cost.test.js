import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {publicationDesignPreview} from '../src/publication-design-preview.js';
test('website checkpoints stay within query budgets and retain exact saved content',{timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-cost-')),book=sampleNotebook();let fixture;
 const query=Client.prototype.query;let measured=null;const reports=[];
 const counter=t.mock.method(Client.prototype,'query',function(...args){
  if(measured){const sql=typeof args[0]==='string'?args[0]:args[0].text;measured.set(sql,(measured.get(sql)??0)+1);}
  return query.apply(this,args);
 });
 async function measure(name,operation){measured=new Map();const start=performance.now();try{return await operation();}finally{const report={name,ms:performance.now()-start,queries:[...measured.values()].reduce((sum,count)=>sum+count,0)};reports.push(report);t.diagnostic(JSON.stringify(report));measured=null;}}
 try{
  fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),id=(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Workflow qualification'})).id;
  const initial=await sites.read(id),home={...initial.book.website.home,enabled:true,sections:Array.from({length:80},(_,i)=>({id:randomUUID(),kind:'text',title:'Observation '+i,body:('Evidence for observation '+i+'. ').repeat(40),show:true}))};
  await sites.save(id,{workspaceId:book.id,baseEtag:initial.etag,websitePin:initial.websitePin,metadata:{website:{...initial.book.website,home}},projects:[],changes:[],removed:[],selection:initial.site.selection});
  const editor=new WebsiteEditor(fixture.workspace),common={workspaceId:book.id,websiteId:id};
  let current=await measure('open',()=>editor.execute('open',{...common,initialView:true}));
  async function preview(){const result=await publicationDesignPreview(websiteWorkspace(fixture.workspace,id),{mode:'website',websitePin:current.websitePin,websiteDraft:current.draft?{id:current.draft.id,revision:current.draft.revision}:undefined,designTarget:'home',workspaceContent:true});assert.ok(result.candidate);}
  await measure('preview-before',preview);
  for(let n=0;n<20;n++){
   home.sections=home.sections.slice(0,-1);
   current=await measure('remove-'+n,()=>editor.execute('change',{...common,websitePin:current.websitePin,draftId:current.draft?.id??null,expectedRevision:current.draft?.revision??null,commandId:randomUUID(),operations:[{type:'settings',path:['document','website','home'],value:home}]}));
   assert.equal(current.site.document.website.home.sections.length,home.sections.length);await measure('preview-'+n,preview);
  }
  current=await measure('save',()=>editor.execute('save',{...common,websitePin:current.websitePin,draftId:current.draft.id,expectedRevision:current.draft.revision,commandId:randomUUID()}));
  assert.deepEqual((await sites.read(id)).book.website.home,home);
  for(const [name,limit] of [['open',120],['remove-0',300],['remove-1',220],['save',270]])assert.ok(reports.find(value=>value.name===name).queries<=limit,name+' exceeded its query budget');
  for(const prefix of ['remove-','preview-']){
   const samples=reports.filter(value=>value.name.startsWith(prefix)&&value.name!=='preview-before').map(value=>value.ms).sort((a,b)=>a-b);
   t.diagnostic(JSON.stringify({operation:prefix.slice(0,-1),samples:samples.length,p50Ms:samples[Math.ceil(samples.length*.5)-1],p95Ms:samples[Math.ceil(samples.length*.95)-1],p99Ms:samples.at(-1)}));
  }
 }finally{counter.mock.restore();if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
