import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {selectedPublicationRows,selectedPublicationRecords} from '../src/publication-source.js';
import {PublicationPreviewOwner} from '../src/publication-preview-owner.js';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {projectSourceAttachmentChoices} from '../src/website-source-selections.js';
import {publicationRecords} from '../src/publication-records.js';
import {readingKey} from '../src/record-reading-index.js';
import {publicationReadingKey} from '../src/record-publication-index.js';
import {publicationSourceIdentity} from '../src/publication-owner-identities.js';
import {emptyPublicationSource} from '../src/web/publication-sources-model.js';
import {withWebsiteSourceSelections,websiteSourceSummary,sourceSelectionReader,sourceEditionReader,preserveSourceSelection} from '../src/website-source-selections.js';

async function document(sources){
 const values=new Map(),blocks={async put(kind,value){const revision=digest(serialize(value));values.set(kind+':'+revision,structuredClone(value));return revision;},async read(kind,revision){const value=values.get(kind+':'+revision);assert.ok(value);return structuredClone(value);}};
 blocks.tree=()=>new RecordValueTree(blocks);const tree=blocks.tree(),root=await tree.retain({document:{website:{researchSources:sources}}}),result=new RecordDocument(blocks,root),original=result.tree.read.bind(result.tree);let maximum=0;
 result.tree.read=async revision=>{const value=await original(revision);maximum=Math.max(maximum,Buffer.byteLength(JSON.stringify(value)));assert.ok(!Array.isArray(value)||value.length<=100,'A read must not materialize a growing selection array');return value;};
 return {result,maximum:()=>maximum};
}
const choice=()=>({id:randomUUID(),share:true,attachments:[]});
const edition=()=>({id:randomUUID(),revision:'a'.repeat(64),include:true,body:true,sections:[],fields:[],attachments:[],figures:[]});

test('native source traversal pages past aggregate owner and record limits without materializing arrays',async()=>{
 const sources=Array.from({length:101},()=>emptyPublicationSource(randomUUID()));
 sources[0].selection.records=Array.from({length:1101},choice);sources[1].selection.records=[{...sources[0].selection.records[0],share:false}];
 const saved=serialize(sources),{result,maximum}=await document(sources);assert.equal((await websiteSourceSummary(result)).count,101);
 await withWebsiteSourceSelections(result,async reader=>{
  assert.equal(reader.count,101);let count=0;
  for await(const source of reader.items()){assert.deepEqual(source.selection.records,[]);count++;}
  assert.equal(count,101);const first=await reader.get(sources[0].workspaceId),second=await reader.get(sources[1].workspaceId),id=sources[0].selection.records[0].id;
  assert.equal(sourceSelectionReader(first.selection).count(),1101);assert.equal((await sourceSelectionReader(first.selection).get(id)).share,true);assert.equal((await sourceSelectionReader(second.selection).get(id)).share,false);
  assert.equal(await reader.get(randomUUID()),null);const copy=preserveSourceSelection(first,structuredClone(first));assert.equal((await sourceSelectionReader(copy.selection).get(id)).share,true);
 });
 assert.equal(serialize(sources),saved);assert.ok(maximum()<4096);
});

test('retained foreign edition choices exceed the old aggregate ceiling with exact keyed access',async()=>{
 const source=emptyPublicationSource(randomUUID());source.edition={version:1,records:Array.from({length:10001},edition)};const {result,maximum}=await document([source]);
 await withWebsiteSourceSelections(result,async reader=>{
  const row=await reader.get(source.workspaceId),choices=sourceEditionReader(row);assert.equal(choices.count('records'),10001);assert.deepEqual(await choices.get('records',source.edition.records.at(-1).id),source.edition.records.at(-1));
  let count=0;for await(const value of choices.items('records')){assert.deepEqual(value,source.edition.records[count]);count++;}assert.equal(count,10001);
 });assert.ok(maximum()<4096);
});

test('duplicate late choices and cancelled reads never admit a partial foreign selection',async()=>{
 const source=emptyPublicationSource(randomUUID());source.selection.records=[choice()];source.selection.records.push({...source.selection.records[0]});const {result}=await document([source]);let admitted=false;
 await assert.rejects(withWebsiteSourceSelections(result,()=>{admitted=true;}),{code:'INVALID'});assert.equal(admitted,false);
 const malformed=emptyPublicationSource(randomUUID());malformed.unexpected=true;const bad=await document([malformed]);await assert.rejects(withWebsiteSourceSelections(bad.result,()=>{admitted=true;}),{code:'INVALID'});assert.equal(admitted,false);
 const controller=new AbortController();controller.abort();await assert.rejects(withWebsiteSourceSelections(result,()=>{admitted=true;},{signal:controller.signal}),{name:'AbortError'});assert.equal(admitted,false);
});


test('the paged preparation reader cannot enable private records or books and rejects nonexistent attachments',async()=>{
 const projectId=randomUUID(),notebookId=randomUUID(),source=emptyPublicationSource(randomUUID()),publicRecord={id:randomUUID(),position:0,notebookId,share:true,publication:{attachments:[]}},privateRecord={...publicRecord,id:randomUUID(),position:1,share:false};
 source.projectIds=[projectId];source.selection.records=[publicRecord,privateRecord].map(row=>({id:row.id,share:true,attachments:[]}));
 const metadata={id:source.workspaceId,projects:[{id:projectId,share:true}],notebooks:[{id:notebookId,projectId,share:true}]},snapshot={metadata,records:[publicRecord,privateRecord]};
 const store={async member(_snapshot,id){return snapshot.records.find(row=>row.id===id);},async *queryDocuments(rows){for await(const row of rows)yield row;}};
 const {result}=await document([source]);
 await withWebsiteSourceSelections(result,async reader=>{
  const selected=await reader.get(source.workspaceId),options={metadata,selection:selected.selection};
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,options))).map(row=>row.row.id),[publicRecord.id]);
  metadata.notebooks[0].share=false;assert.deepEqual(await Array.fromAsync(selectedPublicationRows(store,snapshot,options)),[]);metadata.notebooks[0].share=true;
 });
 source.selection.records[0].attachments=[{id:randomUUID(),share:true}];const bad=await document([source]);
 await withWebsiteSourceSelections(bad.result,async reader=>{const selected=await reader.get(source.workspaceId);await assert.rejects(Array.fromAsync(selectedPublicationRows(store,snapshot,{metadata,selection:selected.selection})),{code:'INVALID'});});
});


test('a sparse paged source reads only explicit members while preserving saved position cursors',async()=>{
 const projectId=randomUUID(),notebookId=randomUUID(),source=emptyPublicationSource(randomUUID());source.projectIds=[projectId];
 const records=Array.from({length:300},(_,position)=>({id:randomUUID(),position,notebookId,share:true,publication:{attachments:[]}}));
 source.selection.records=[records[290],records[3]].map(row=>({id:row.id,share:true,attachments:[]}));
 const metadata={id:source.workspaceId,projects:[{id:projectId,share:true}],notebooks:[{id:notebookId,projectId,share:true}]},snapshot={metadata,records};let summaries=0,lookups=0;
 const selected=new Set(source.selection.records.map(choice=>choice.id)),store={async member(_snapshot,id){lookups++;assert.ok(selected.has(id),'Unselected member read');return records.find(row=>row.id===id);},async *queryDocuments(rows){for await(const row of rows){summaries++;assert.ok(selected.has(row.id),'Unselected summary read');yield row;}}};
 const {result}=await document([source]);await withWebsiteSourceSelections(result,async reader=>{
  const value=await reader.get(source.workspaceId),options={metadata,selection:value.selection};
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,options))).map(row=>row.row.position),[3,290]);
  assert.equal(summaries,4);assert.equal(lookups,2);
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,{...options,page:{after:3,offset:0,limit:1}}))).map(row=>row.row.position),[290]);assert.equal(lookups,2);
 });
});


test('large explicit selections build their ordered temporary index once rather than rescanning each window',async()=>{
 const projectId=randomUUID(),notebookId=randomUUID(),source=emptyPublicationSource(randomUUID());source.projectIds=[projectId];
 const records=Array.from({length:300},(_,position)=>({id:randomUUID(),position,notebookId,share:true,publication:{attachments:[]}})),chosen=records.filter(row=>row.position%2===0),selected=new Map(chosen.map(row=>[row.id,row]));
 source.selection.records=[...chosen].reverse().map(row=>({id:row.id,share:true,attachments:[]}));
 const metadata={id:source.workspaceId,projects:[{id:projectId,share:true}],notebooks:[{id:notebookId,projectId,share:true}]},snapshot={metadata,records};let lookups=0;
 const store={async member(_snapshot,id){lookups++;assert.ok(selected.has(id));return selected.get(id);},async *queryDocuments(rows){for await(const row of rows){assert.ok(selected.has(row.id));yield row;}}};
 const {result}=await document([source]);await withWebsiteSourceSelections(result,async reader=>{
  const value=await reader.get(source.workspaceId),options={metadata,selection:value.selection};
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,options))).map(row=>row.row.position),chosen.map(row=>row.position));assert.equal(lookups,150);
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,{...options,page:{after:256,offset:0,limit:2}}))).map(row=>row.row.position),[258,260]);assert.equal(lookups,150);
  assert.deepEqual((await Array.fromAsync(selectedPublicationRows(store,snapshot,{...options,page:{after:0,recordId:records[290].id,offset:0,limit:1}}))).map(row=>row.row.position),[290]);assert.equal(lookups,150);
 });
});


test('prior native snapshots preserve sparse and included-book source order in both cursor directions',async()=>{
 const uuid=value=>'00000000-0000-4000-8000-'+value.toString(16).padStart(12,'0'),workspaceId=uuid(900),projects=[901,902,903].map(value=>({id:uuid(value),share:true})),notebooks=projects.map((project,i)=>({id:uuid(910+i),projectId:project.id,share:true}));
 const records=Array.from({length:36},(_,position)=>({id:uuid(position+1),position,notebookId:notebooks[position%3].id,share:position%7!==0,occurredOn:'2026-10-'+String(position%4+1).padStart(2,'0'),publication:{attachments:[]}})),originals=new Map(records.map(row=>[row.id,row]));
 const explicit=[records[1],records[3],records[7],records[10],records[19],records[28]],excluded=records[6];
 for(const indexed of [false,true])for(const included of [false,true]){
  const source=emptyPublicationSource(workspaceId);source.projectIds=projects.slice(0,2).map(project=>project.id);source.selection.includeProjects=included?[projects[0].id]:[];
  source.selection.records=[...explicit.map(row=>({id:row.id,share:true,attachments:[]})),{id:excluded.id,share:false,attachments:[]}];
  const metadata={id:workspaceId,projects,notebooks},members=records.map(({id,position})=>({id,revision:digest(id),bytes:1,...(indexed?{position}:{})})),snapshot=indexed?{indexVersion:1,metadata,count:members.length,nextPosition:members.length}:{metadata,records:members},before=serialize(snapshot);let scans=0,reads=0;
  const store={
   async member(_snapshot,id){assert.equal(_snapshot,snapshot);return members.find(row=>row.id===id)??null;},
   async *members(_snapshot){assert.equal(_snapshot,snapshot);scans++;for(let position=0;position<members.length;position++)yield indexed?members[position]:{...members[position],position};},
   async record(id,revision){assert.equal(revision,digest(id));reads++;return originals.get(id);},
   async *queryDocuments(rows){for await(const row of rows)yield originals.get(row.id);}
  };
  const {result}=await document([source]);await withWebsiteSourceSelections(result,async sources=>{
   const selected=await sources.get(workspaceId),scope=new Set(notebooks.slice(0,2).map(book=>book.id)),options={metadata,selection:selected.selection,notebooks:scope,overrides:new Map()},allowed=records.filter(row=>row.share&&scope.has(row.notebookId)&&row.id!==excluded.id&&(explicit.some(choice=>choice.id===row.id)||included&&row.notebookId===notebooks[0].id));
   const all=async options=>Array.fromAsync(publicationRecords(store,snapshot,options)),ids=rows=>rows.map(row=>row.id);
   const sort=(rows,order)=>[...rows].sort((a,b)=>{const key=value=>order==='publication'?publicationReadingKey(value,workspaceId):readingKey(value,order);return key(a)<key(b)?-1:key(a)>key(b)?1:0;});
   assert.notDeepEqual(ids(sort(allowed,'date')),ids(sort(allowed,'publication')),'Public identities must exercise a different tie order');
   for(const order of ['position','date','publication']){
    const expected=sort(allowed,order),anchor=row=>order==='position'?row.position:order==='publication'?{...row,id:publicationSourceIdentity(workspaceId,'record',row.id)}:row;
    for(const backward of [false,true]){
     const expectedOrder=backward?[...expected].reverse():expected,actual=[];let after=null;
     for(let page=0;page<=expected.length;page++){
      const window=[];for await(const row of publicationRecords(store,snapshot,{...options,order,backward,after})){window.push(row);if(window.length===3)break;}
      if(!window.length)break;actual.push(...window);after=anchor(window.at(-1));
     }
     assert.deepEqual(ids(actual),ids(expectedOrder),JSON.stringify({indexed,included,order,backward}));
     const middle=expected[2],at=anchor(middle);
     assert.deepEqual(ids(await all({...options,order,after:at,backward})),ids(backward?expected.slice(0,2).reverse():expected.slice(3)));
    }
    const scansBefore=scans,readsBefore=reads;await all({...options,order});assert.equal(scans,scansBefore,'A later window reuses its operation-owned ordering');assert.equal(reads,readsBefore,'A later window does not reload original headers');
    const target=expected.at(-1);assert.deepEqual(ids(await all({...options,order,recordId:target.id})),[target.id]);
    assert.deepEqual(await all({...options,order,recordId:records[7].id}),[],'Explicit private originals stay private');
    assert.deepEqual(await all({...options,order,recordId:records[2].id}),[],'An unselected sibling book stays excluded');
   }
   assert.equal(scans,included?3:0,'Sparse sources never scan unrelated members');
  });assert.equal(serialize(snapshot),before,'Reading must not rewrite an old snapshot or its member metadata');
 }
 const missing=emptyPublicationSource(workspaceId);missing.projectIds=[projects[0].id];missing.selection.records=[{id:uuid(999),share:true,attachments:[]}];const {result}=await document([missing]);
 await withWebsiteSourceSelections(result,async sources=>{const source=await sources.get(workspaceId);await assert.rejects(Array.fromAsync(publicationRecords({member:async()=>null},{metadata:{id:workspaceId},records:[]},{metadata:{id:workspaceId,notebooks},selection:source.selection,notebooks:new Set(notebooks.map(book=>book.id)),overrides:new Map()})),{code:'RECORD_CHANGED'});});
});


function removedChoiceFixture(){
 const projectId=randomUUID(),notebookId=randomUUID(),removed=randomUUID(),attachmentId=randomUUID(),source=emptyPublicationSource(randomUUID());source.projectIds=[projectId];
 const record={id:randomUUID(),position:1,notebookId,share:true,attachments:[],publication:{attachments:[]}},metadata={id:source.workspaceId,projects:[{id:projectId,share:true}],notebooks:[{id:notebookId,projectId,share:true}]};
 source.selection.records=[{id:removed,share:false,attachments:[]},{id:record.id,share:true,attachments:[{id:attachmentId,share:false}]}];
 const originalRecords=new Map([[record.id,record]]),store={async member(snapshot,id){return snapshot.records.find(row=>row.id===id);},async *queryDocuments(rows){yield* rows;},async record(id){return originalRecords.get(id);}};
 return {source,record,removed,attachmentId,metadata,store,originalRecords,snapshot:{metadata,records:[record]}};
}

test('excluded deleted records and attachments do not trap preview or preparation and remain excluded after restoration',async()=>{
 const f=removedChoiceFixture(),before=serialize(f.source),{result}=await document([f.source]);
 const check=async source=>{
  const options={metadata:f.metadata,selection:source.selection};assert.deepEqual((await Array.fromAsync(selectedPublicationRows(f.store,f.snapshot,options))).map(value=>value.row.id),[f.record.id]);
  const owner=new PublicationPreviewOwner(source,null,new PublicationOwnerIdentities(randomUUID()));owner.metadata=f.metadata;
  await owner.overrides(f.store,f.snapshot);assert.deepEqual((await owner.admit(f.store,f.snapshot,f.record)).patch.attachments,[]);assert.deepEqual(Object.values(await owner.countValues(f.store,f.snapshot)),[1]);
  const restored={...f.record,attachments:[{id:f.attachmentId,share:true}],publication:{attachments:[{id:f.attachmentId,share:true}]}},excluded={...f.record,id:f.removed,position:0};f.originalRecords.set(restored.id,restored);f.originalRecords.set(excluded.id,excluded);
  const snapshot={metadata:f.metadata,records:[excluded,restored]},records=await Array.fromAsync(selectedPublicationRecords(f.store,snapshot,options));assert.deepEqual(records.map(row=>row.id),[f.record.id]);assert.equal(records[0].attachments[0].share,false);
 };
 await check(f.source);await withWebsiteSourceSelections(result,async reader=>check(await reader.get(f.source.workspaceId)));assert.equal(serialize(f.source),before);
});

test('missing positive, inherited and revision-pinned source choices continue to refuse publication',async()=>{
 const f=removedChoiceFixture(),run=async source=>{const {result}=await document([source]);await withWebsiteSourceSelections(result,async reader=>{const value=await reader.get(source.workspaceId);await assert.rejects(Array.fromAsync(selectedPublicationRows(f.store,f.snapshot,{metadata:f.metadata,selection:value.selection})),{code:'RECORD_CHANGED'});});};
 for(const share of [true,null]){const source=structuredClone(f.source);source.selection.records[0].share=share;await run(source);await assert.rejects(Array.fromAsync(selectedPublicationRows(f.store,f.snapshot,{metadata:f.metadata,selection:source.selection})),{code:'RECORD_CHANGED'});}
 const pin={...edition(),id:f.removed};
 for(const collection of ['records','history']){const source=structuredClone(f.source);source.edition={version:1,records:collection==='records'?[pin]:[],...(collection==='history'?{history:[pin]}:{})};await run(source);const owner=new PublicationPreviewOwner(source,null,new PublicationOwnerIdentities(randomUUID()));await assert.rejects(owner.overrides(f.store,f.snapshot),{code:'RECORD_CHANGED'});}
 const source=structuredClone(f.source);source.selection.records[1].attachments[0].share=true;const {result}=await document([source]);await withWebsiteSourceSelections(result,async reader=>{const value=await reader.get(source.workspaceId);await assert.rejects(Array.fromAsync(selectedPublicationRows(f.store,f.snapshot,{metadata:f.metadata,selection:value.selection})),{code:'INVALID'});const owner=new PublicationPreviewOwner(value,null,new PublicationOwnerIdentities(randomUUID()));owner.metadata=f.metadata;await assert.rejects(owner.admit(f.store,f.snapshot,f.record),{code:'INVALID'});});
});

test('negative attachment projection preserves the existing saved-positive host admission policy',()=>{
 const id=randomUUID(),negative={id,share:false},positive={id,share:true};assert.deepEqual(projectSourceAttachmentChoices([negative],[]),[]);assert.deepEqual(negative,{id,share:false});
 assert.throws(()=>projectSourceAttachmentChoices([positive],[]),{code:'INVALID'});assert.throws(()=>projectSourceAttachmentChoices([positive],[],[negative]),{code:'INVALID'});assert.deepEqual(projectSourceAttachmentChoices([positive],[],[positive]),[]);assert.deepEqual(projectSourceAttachmentChoices([negative],[{id}]),[negative]);
});
