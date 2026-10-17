import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPublicationInput,publicationInputState,openPublicationInput,publicationRecordIndexes} from '../src/publication-input-reader.js';
import {publicationCollectionItems,publicationCollectionCount} from '../src/publication-edition-projection.js';
import {publicationEditionParts} from '../src/publication-edition-fragments.js';

async function fixture(){
 const files=new Map(),workspace={async readMetadata(file){return files.get(file)??null;},async writeMetadata(file,text){files.set(file,text);}},projects=[{id:'project-a',share:true},{id:'project-b',share:true}],notebooks=[{id:'book-a',projectId:'project-a'},{id:'book-b',projectId:'project-b'},{id:'empty-book',projectId:'project-a'}],pages=Array.from({length:4},(_,index)=>({id:'page-'+index,title:'Page '+index,share:index<2})),metadata={id:randomUUID(),formatVersion:21,projects,notebooks,pages,branding:[],website:{navigation:[],assets:[],layouts:[],presentation:{media:[],covers:[]}}};
 const source=createPublicationInput(workspace,randomUUID(),metadata),{builder}=publicationInputState(source),records=[];
 for(const row of projects)await builder.append('projects',row.id,row,{indexes:{title:row.id}});
 for(const row of notebooks)await builder.append('notebooks',row.id,row,{indexes:row.id==='empty-book'?{}:{included:'yes/',project:row.projectId+'/',projectTitle:row.projectId+'/'+row.id,title:row.id}});
 for(const row of pages)await builder.append('pages',row.id,row,{indexes:row.share?{shared:'yes/',title:row.id}:{}});
 for(let index=0;index<12;index++){
  const date=String(index).padStart(3,'0'),notebookId=index<8?'book-a':'book-b',projectId=index<8?'project-a':'project-b',row={id:'record-'+date,notebookId,historical:index%4===0,tags:index%3===0?['selected']:[],occurredOn:'2026-01-'+String(12-index).padStart(2,'0')},indexes=publicationRecordIndexes(row,index,projectId);
  records.push(row);await builder.append('records',row.id,row,{indexes});
 }
 return {input:await openPublicationInput(workspace,source),workspace,metadata,records};
}
const iteratedCount=async(input,section)=>{let count=0;for await(const value of publicationCollectionItems(input,section)){void value;count++;}return count;};
const bind=(input,overrides)=>new Proxy(input,{get(target,key){if(Object.hasOwn(overrides,key))return overrides[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
const parts=(input,plan,signal)=>publicationEditionParts(input,plan,{writer:{},media:{},mediaFiles:new Map(),context:{},esc:value=>value,signal});

test('indexed counts match exact retained scopes and limits without enumerating collection rows',async()=>{
 const {input}=await fixture(),noScan=bind(input,{records(){assert.fail('Counting traversed records');},items(){assert.fail('Counting traversed a collection');}}),sections=[];
 for(const kind of ['records','pages','projects','notebooks'])for(const projectId of [null,'project-a','missing'])for(const limit of [0,1,3,100])sections.push({kind,filter:{projectId,tag:'',limit},feed:{order:kind==='records'?'oldest':'reverse-alphabetical'}});
 for(const section of sections)assert.equal(await publicationCollectionCount(noScan,section),await iteratedCount(input,section),JSON.stringify(section));
 assert.equal(await publicationCollectionCount(noScan,{kind:'records'}),12,'Historical records remain included');
 assert.equal(await input.recordCount({historical:false}),9);
 assert.equal(await publicationCollectionCount(noScan,{kind:'notebooks'}),2,'Empty books remain excluded');
 assert.equal(await publicationCollectionCount(noScan,{kind:'pages'}),2,'Private page labels remain excluded');
});

test('tagged counts preserve ordered filtering and stop at the authored limit',async()=>{
 const {input}=await fixture();let visited=0;
 const tracked=bind(input,{recordCount(){assert.fail('A tag cannot use the unfiltered count');},count(){assert.fail('A tag cannot use the unfiltered count');},async *records(options){for await(const row of input.records(options)){visited++;yield row;}}});
 const section={kind:'records',filter:{projectId:'project-a',tag:'selected',limit:1},feed:{order:'oldest'}};
 assert.equal(await publicationCollectionCount(tracked,section),1);assert.equal(visited,2,'Reverse scope order reaches the selected row after two candidates');
 visited=0;section.filter.limit=0;assert.equal(await publicationCollectionCount(tracked,section),3);assert.equal(visited,8);
 visited=0;section.filter.tag='absent';assert.equal(await publicationCollectionCount(tracked,section),0);assert.equal(visited,8);
 visited=0;assert.equal(await publicationCollectionCount(tracked,{kind:'pages',filter:{tag:'selected'}}),0);assert.equal(visited,0);
});

test('legacy counts keep private-project and historical inclusion semantics',async()=>{
 const {workspace,metadata,records}=await fixture(),input=await openPublicationInput(workspace,{version:2,metadata:{...metadata,projects:[...metadata.projects,{id:'private-project',share:false}]},records});
 for(const section of [{kind:'records'},{kind:'records',filter:{projectId:'project-a',tag:'selected',limit:2}},{kind:'projects',filter:{projectId:'private-project'}},{kind:'projects'},{kind:'notebooks',filter:{projectId:'project-a'}},{kind:'pages',filter:{limit:1}}])assert.equal(await publicationCollectionCount(input,section),await iteratedCount(input,section));
});

test('body and reference continuations reuse successful plan totals, including zero',async()=>{
 let scans=0,indexed=0;const input={async *records(){scans++;yield {tags:['selected']};yield {tags:[]};},async count(){indexed++;return 4;}},plan={target:'home',collections:[{section:{kind:'records',filter:{tag:'selected'}}},{section:{kind:'records',filter:{tag:'absent'}}},{section:{kind:'pages'}}]};
 await parts(input,plan);assert.deepEqual(plan.collections.map(row=>row.total),[1,0,4]);
 for(let continuation=0;continuation<8;continuation++)await parts(input,plan);
 assert.equal(scans,2);assert.equal(indexed,1);
 const fresh={target:'home',collections:plan.collections.map(({section})=>({section}))};await parts(input,fresh);assert.equal(scans,4);assert.equal(indexed,2,'A different plan owns its own totals');
 const controller=new AbortController(),cancelled=Error('cancelled continuation');controller.abort(cancelled);await assert.rejects(parts(input,plan,controller.signal),error=>error===cancelled);
});

test('failed or cancelled counts never publish a reusable plan total',async()=>{
 const failed=Error('broken retained row'),section={kind:'records',filter:{tag:'selected'}},plan={target:'home',collections:[{section}]};let fail=true,calls=0;
 const input={async *records(){calls++;yield {tags:['selected']};if(fail)throw failed;}};
 await assert.rejects(parts(input,plan),error=>error===failed);assert.equal(Object.hasOwn(plan.collections[0],'total'),false);
 fail=false;await parts(input,plan);await parts(input,plan);assert.equal(plan.collections[0].total,1);assert.equal(calls,2);
 const controller=new AbortController(),cancelled=Error('cancelled index read'),pending={target:'home',collections:[{section:{kind:'pages'}}]},counting={async count(){controller.abort(cancelled);return 4;}};
 await assert.rejects(parts(counting,pending,controller.signal),error=>error===cancelled);assert.equal(Object.hasOwn(pending.collections[0],'total'),false);
});
