import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfOutlineUI} from '../src/web/pdf-outline-ui.js';
import {fixture} from './project-domain-fixture.js';
const section=(title,content='Retained body '.repeat(3000))=>({id:randomUUID(),title,content,layout:null,start:null});
const command=(id,expectedRevision,operation)=>({id,commandId:randomUUID(),expectedRevision,operation});
const creation=first=>{const id=randomUUID();return command(id,null,{type:'create',header:{version:1,id,name:'Outline',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:first});};
function memory(){
 const data=new Map(),owner={domain:'pdf',async object(id){return structuredClone(data.get(id)??null);},async putObject(id,value){data.set(id,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...data.keys()].sort())if(key.startsWith(prefix))yield key;}};
 return {data,owner,documents:new PdfDocumentStore(owner)};
}
async function populated(count){
 const value=memory(),sections=Array.from({length:count},(_,i)=>section('Section '+i)),create=creation(sections[0]);let saved=await value.documents.change(create);
 for(const item of sections.slice(1))saved=await value.documents.change(command(create.id,saved.revision,{type:'append',section:item}));
 return {...value,id:create.id,sections,saved};
}
async function all(d,id,revision){
 const items=[];let offset=0;do{const page=await d.outline(id,{revision,offset});items.push(...page.items);offset=page.next;}while(offset!==null);return items;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const input=(name,value)=>({value,dataset:{},hasAttribute:key=>key==='data-pdf-outline-'+name});
const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

test('PDF outline scans at most 100 selected titles and preserves exact old-revision continuations',async()=>{
 const {documents:d,owner,id,sections,saved}=await populated(205),target={...sections[204],title:'Needle in late section'},named=await d.change(command(id,saved.revision,{type:'section',section:target}));
 const latest=await d.change(command(id,named.revision,{type:'section',section:{...target,title:'Renamed current section'}}));
 const original=owner.object.bind(owner),full=d.sectionRow;let headers=0;const selected=d.sectionHeader.bind(d);
 d.sectionHeader=async(...args)=>{headers++;return selected(...args);};d.sectionRow=()=>{throw Error('whole section loaded');};
 owner.object=async key=>{const value=await original(key);assert.notEqual(value?.type,'bytes','outline read a retained body chunk');return value;};
 owner.objectIdEntries=async function*(){throw Error('outline scanned metadata');};
 let offset=0;for(const expected of [100,100,5]){
  headers=0;const page=await d.outline(id,{revision:named.revision,query:'  ＮＥＥＤＬＥ  ',offset});
  assert.equal(page.revision,named.revision);assert.equal(page.currentRevision,latest.revision);assert.equal(page.query,'needle');assert.equal(page.total,205);assert.equal(page.scanned,expected);assert.equal(headers,expected);
  if(expected===5){assert.deepEqual(page.items.map(row=>[row.id,row.ordinal]),[[target.id,204]]);assert.equal(page.next,null);}else assert.deepEqual(page.items,[]);offset=page.next;
 }
 assert.equal((await d.outline(id,{revision:latest.revision,query:'needle',offset:200})).items.length,0);
 assert.deepEqual((await d.outline(id,{revision:named.revision,offset:500})).items,[]);
 await assert.rejects(d.outline(id,{revision:'a'.repeat(64)}),{code:'NOT_FOUND'});await assert.rejects(d.outline(id,{limit:21,revision:named.revision}),{code:'INVALID'});await assert.rejects(d.outline(id,{}),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(d.outline(id,{revision:named.revision},{signal:controller.signal}),{name:'AbortError'});
 d.sectionRow=full;
});

test('PDF move-to rotates sparse positions without loading bodies and preserves history, no-op and exact retry semantics',async()=>{
 const {documents:d,owner,data,id,sections,saved}=await populated(70),removed=await d.change(command(id,saved.revision,{type:'remove-section',sectionId:sections[10].id})),before=(await all(d,id,removed.revision)).map(row=>row.id);
 const rootBefore=await d.revision(id,removed.revision),index=d.index(id),tree=new RecordValueTree({read:async(kind,revision)=>data.get('pdf:block:'+id+':'+kind+':'+revision)}),references=new Map();
 for(const key of before){const row=await index.find({root:rootBefore.sections},key);references.set(key,await tree.select(row.revision,['section']));}
 const originalRead=owner.object.bind(owner),originalWrite=owner.putObject.bind(owner),full=d.sectionRow;
 owner.object=async key=>{const value=await originalRead(key);assert.notEqual(value?.type,'bytes','move read a retained body chunk');return value;};
 owner.putObject=async(key,value)=>{assert.notEqual(value?.type,'bytes','move rewrote body bytes');return originalWrite(key,value);};d.sectionRow=()=>{throw Error('whole section loaded');};
 const move=command(id,removed.revision,{type:'move-to',sectionId:sections[2].id,position:68}),moved=await d.change(move),expected=before.filter(key=>key!==sections[2].id);expected.splice(68,0,sections[2].id);
 assert.deepEqual((await all(d,id,moved.revision)).map(row=>row.id),expected);assert.deepEqual((await all(d,id,removed.revision)).map(row=>row.id),before);
 const rootAfter=await d.revision(id,moved.revision);for(const key of before){const row=await index.find({root:rootAfter.sections},key);assert.deepEqual(await tree.select(row.revision,['section']),references.get(key));}
 assert.deepEqual(await d.change(move),{revision:moved.revision,replayed:true});await assert.rejects(d.change({...move,operation:{...move.operation,position:0}}),{code:'MODULE_REPLAY'});
 await assert.rejects(d.change(command(id,removed.revision,{type:'move-to',sectionId:sections[2].id,position:0})),{code:'CONFLICT'});
 const sequence=(await d.head(id)).sequence,noOp=command(id,moved.revision,{type:'move-to',sectionId:sections[2].id,position:68});
 assert.equal((await d.change(noOp)).revision,moved.revision);assert.equal((await d.head(id)).sequence,sequence);assert.equal((await d.change(noOp)).replayed,true);
 await assert.rejects(d.change(command(id,moved.revision,{type:'move-to',sectionId:sections[2].id,position:69})),{code:'INVALID'});
 await assert.rejects(d.change(command(id,moved.revision,{type:'move-to',sectionId:randomUUID(),position:0})),{code:'NOT_FOUND'});
 const first=await d.change(command(id,moved.revision,{type:'move-to',sectionId:sections[2].id,position:0}));assert.equal((await all(d,id,first.revision))[0].id,sections[2].id);
 owner.object=originalRead;owner.putObject=originalWrite;d.sectionRow=full;await d.verify();
 const empty=memory(),single=creation(section('Only','body')),initial=await empty.documents.change(single),gone=await empty.documents.change(command(single.id,initial.revision,{type:'remove-section',sectionId:single.operation.section.id}));
 assert.deepEqual(await empty.documents.outline(single.id,{revision:gone.revision}),{revision:gone.revision,currentRevision:gone.revision,query:'',offset:0,scanned:0,total:0,items:[],next:null});
});

test('PDF outline controller keeps bounded pages, exact selection pins and a single move identity across a lost response',async()=>{
 const id=randomUUID(),sectionId=randomUUID(),revision='a'.repeat(64),changed='b'.repeat(64);let document={header:{id},revision,count:205},section={id:sectionId,title:'Selected'},fail=true,draws=0;const calls=[],selections=[];
 const ui=pdfOutlineUI({esc,text:key=>key,draw:()=>draws++,getDocument:()=>document,getSection:()=>section,changedSelection:async value=>{selections.push(value);document={...document,revision:value.revision};},post:async(name,data,options)=>{
  calls.push({name,data:structuredClone(data),signal:options?.signal});
  if(name==='change'){if(fail){fail=false;throw Error('lost response');}return {revision:changed,replayed:true};}
  return {revision,currentRevision:revision,query:data.query.trim().toLowerCase(),offset:data.offset,scanned:100,total:205,items:data.offset===100?[{id:sectionId,title:'<Late>',level:1,position:104,ordinal:104}]:[],next:data.offset===0?100:null};
 }});
 ui.input(input('query',' late '));await ui.action('outline-search');assert.match(ui.view(),/outlineContinue/);await ui.action('outline-next');assert.deepEqual(calls.filter(row=>row.name==='outline').map(row=>row.data.offset),[0,100]);assert.match(ui.view(),/&lt;Late&gt;/);
 await ui.action('outline-open',{dataset:{id:sectionId}});assert.deepEqual(selections.at(-1),{documentId:id,revision,sectionId,ordinal:104});
 ui.input(input('position','5'));await assert.rejects(ui.action('outline-move'),/lost response/);await ui.action('outline-move');
 const moves=calls.filter(row=>row.name==='change');assert.equal(moves.length,2);assert.deepEqual(moves[0].data,moves[1].data);assert.equal(moves[0].data.operation.position,4);assert.deepEqual(selections.at(-1),{documentId:id,revision:changed,sectionId,ordinal:4});assert.ok(draws>=3);
 ui.dispose();assert.equal(ui.view(),'');
});

test('PDF outline ignores superseded and disposed search responses and aborts their read signals',async()=>{
 const id=randomUUID(),revision='a'.repeat(64),gates=[],signals=[];let document={header:{id},revision,count:200},draws=0;
 const ui=pdfOutlineUI({esc,text:key=>key,draw:()=>draws++,getDocument:()=>document,getSection:()=>null,changedSelection:async()=>assert.fail('unexpected selection'),post:async(name,data,{signal})=>{const gate=deferred();gates.push({gate,data});signals.push(signal);return gate.promise;}});
 const old=ui.action('outline-search');ui.input(input('query','new'));assert.equal(signals[0].aborted,true);gates[0].gate.resolve({revision,query:'',offset:0,items:[],next:100});await old;assert.equal(draws,0);
 const active=ui.action('outline-search');document={...document,revision:'b'.repeat(64)};gates[1].gate.resolve({revision,query:'new',offset:0,items:[],next:null});await active;assert.equal(draws,0);
 const disposed=ui.action('outline-search');ui.dispose();assert.equal(signals[2].aborted,true);gates[2].gate.resolve({revision:document.revision,query:'new',offset:0,items:[],next:null});await disposed;assert.equal(draws,0);
});

test('PDF domain move-to interruption rolls back position nodes, directories, history and command receipt',{timeout:120000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),sections=Array.from({length:4},(_,i)=>section('Section '+i)),create=creation(sections[0]);let saved=await documents.change(create);
 for(const item of sections.slice(1))saved=await documents.change(command(create.id,saved.revision,{type:'append',section:item}));
 const move=command(create.id,saved.revision,{type:'move-to',sectionId:sections[0].id,position:3}),controller=new AbortController();
 const run=(write,fn)=>documents.domains.run(['pdf'],get=>fn(new PdfDocumentStore(get('pdf')),get('pdf')),{write:write?['pdf']:[]});
 const before=await run(false,async(d,store)=>({head:await d.head(create.id),objects:await Array.fromAsync(store.objectIdEntries('pdf:'))}));
 await assert.rejects(run(true,async(d,store)=>{const put=store.putObject.bind(store);store.putObject=async(key,value)=>{await put(key,value);if(key.startsWith('pdf:block:'+create.id+':value:'))controller.abort();};await d.change(move,{signal:controller.signal});}),{name:'AbortError'});
 await run(false,async(d,store)=>{assert.deepEqual(await d.head(create.id),before.head);assert.deepEqual(await Array.fromAsync(store.objectIdEntries('pdf:')),before.objects);assert.equal(await store.object('pdf:command:'+create.id+':'+move.commandId),null);assert.deepEqual((await all(d,create.id,saved.revision)).map(row=>row.id),sections.map(row=>row.id));});
 const moved=await documents.change(move);assert.notEqual(moved.revision,saved.revision);assert.deepEqual(await documents.change(move),{revision:moved.revision,replayed:true});
 await run(false,async(d,store)=>{assert.deepEqual((await all(d,create.id,moved.revision)).map(row=>row.id),[...sections.slice(1),sections[0]].map(row=>row.id));assert.deepEqual(await d.verify(),{documents:1,editions:5});for await(const row of store.verifiedObjects())assert.ok(row.id);});
});
