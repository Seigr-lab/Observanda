import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {retainedQueryProjection} from '../src/record-query-projection.js';
import {retainRecordText} from '../src/record-text-retention.js';
import {digest,serialize} from '../src/storage-format.js';
import {recordRevision} from '../src/research.js';
import {recordQueryDocument} from '../src/web/record-query.js';
import {recordPublicationSummary} from '../src/web/record-publication-summary.js';
import {publicationDescriptor} from '../src/publication-record-descriptor.js';
import {publicationCard} from '../src/web/publication-card.js';
import {recordEditionInventory} from '../src/web/publication-inventory.js';
import {researchReference} from '../src/web/research-reference.js';
import {sampleNotebook} from '../src/sample.js';
import {attemptFixture} from './fixtures/attempts.js';
import {sameCollectionFields} from '../src/record-projection-dependency.js';
import {mapRecordProjection} from '../src/record-projection-map.js';
import {retainSearchVocabulary} from '../src/record-search-vocabulary.js';
import {retainReferenceIndex} from '../src/record-reference-index.js';

function memory(){
 const nodes=new Map();return {nodes,reads:0,writes:0,
  async put(kind,value){const data=serialize(value),revision=digest(data);assert.ok(Buffer.byteLength(data)<=65536);nodes.set(kind+':'+revision,data);this.writes++;return revision;},
  async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},
  tree(){return new RecordValueTree(this);}
 };
}
test('edited query text reuses saved source fields instead of reconstructing the complete searchable record',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const storage=memory(),record={...sampleNotebook().entries[0],body:'Original summary',figures:[],attachments:[],sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Preserved long evidence '.repeat(500)}))};
  const document=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),vocabulary=await retainSearchVocabulary(document),prior=await retainedQueryProjection(document,recordRevision(record),{searchText:vocabulary.text});
  const next=await document.replace(['title'],'Corrected title'),previous={document,tree:document.tree,root:prior.root,vocabulary},items=next.items.bind(next);
  next.items=(path,options)=>{assert.notEqual(path[0],'sections','Title correction read unchanged sections');return items(path,options);};
  storage.reads=storage.writes=0;const changed=await retainSearchVocabulary(next,{previous}),actual=await retainedQueryProjection(next,recordRevision({...record,title:'Corrected title'}),{previous,searchText:changed.text});
  measured.push(storage.reads);t.diagnostic(count+' sections: joined query update used '+storage.reads+' reads and '+storage.writes+' writes');assert.ok(storage.reads<3500);
  next.items=items;const independent=await retainedQueryProjection(next,recordRevision({...record,title:'Corrected title'}));assert.deepEqual(await next.tree.read(actual.root),await next.tree.read(independent.root));
  assert.equal((await Array.fromAsync(document.tree.text(prior.root,['searchText']))).join(''),recordQueryDocument(record).searchText);
 }
 assert.ok(Math.abs(measured[1]-measured[0])<200,'Query work grew with unchanged source text');
});
test('publication section labels update without rebuilding other selectors or reading unrelated prose',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const storage=memory(),record={...sampleNotebook().entries[0],figures:[],attachments:[],sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Unchanged observation '.repeat(100)}))},document=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),vocabulary=await retainSearchVocabulary(document),prior=await retainedQueryProjection(document,recordRevision(record),{searchText:vocabulary.text});
  const position=1,next=await document.replace(['sections',String(position),'title'],'Changed section'),previous={document,tree:document.tree,root:prior.root,vocabulary},items=next.items.bind(next);
  next.items=(path,flags)=>{assert.notEqual(path[0],'sections','One section title enumerated all sections');return items(path,flags);};storage.reads=storage.writes=0;
  const search=await retainSearchVocabulary(next,{previous}),actual=await retainedQueryProjection(next,recordRevision({...record,sections:record.sections.map((value,i)=>i===position?{...value,title:'Changed section'}:value)}),{previous,searchText:search.text});
  measured.push(storage.reads);assert.ok(storage.reads<4000);t.diagnostic(count+' sections: selected label query update used '+storage.reads+' reads and '+storage.writes+' writes');
  next.items=items;const full=await next.tree.read(next.root),independent=await retainedQueryProjection(next,recordRevision(full));assert.deepEqual(await next.tree.read(actual.root),await next.tree.read(independent.root));
 }
 assert.ok(Math.abs(measured[1]-measured[0])<200);
});
test('one section-body correction reuses unrelated searchable text, reference targets and publication links',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const storage=memory(),book=sampleNotebook(),prose=id=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Linked observation',marks:[{type:'link',attrs:{href:researchReference({workspaceId:book.id,kind:'record',id}),title:'',target:'_self',nofollow:false}}]}]}]}),record={...book.entries[0],figures:[],attachments:[],relations:[],sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Section '+i,body:prose(randomUUID())}))};
  const document=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),vocabulary=await retainSearchVocabulary(document),referenceIndex=await retainReferenceIndex(document),prior=await retainedQueryProjection(document,recordRevision(record),{searchText:vocabulary.text,referenceTargets:referenceIndex.root}),position=1,next=await document.replace(['sections',String(position),'body'],'Corrected observation'),previous={document,tree:document.tree,root:prior.root,vocabulary,referenceIndex},items=next.items.bind(next);
  next.items=(path,flags)=>{assert.notEqual(path[0],'sections','One body correction enumerated all sections');return items(path,flags);};storage.reads=storage.writes=0;
  const search=await retainSearchVocabulary(next,{previous}),references=await retainReferenceIndex(next,{previous}),version=recordRevision({...record,sections:record.sections.map((value,i)=>i===position?{...value,body:'Corrected observation'}:value)}),actual=await retainedQueryProjection(next,version,{previous,searchText:search.text,referenceTargets:references.root});
  measured.push(storage.reads);assert.ok(storage.reads<4000);t.diagnostic(count+' sections: complete body query update used '+storage.reads+' reads and '+storage.writes+' writes');
  next.items=items;const independent=await retainedQueryProjection(next,version);assert.deepEqual(await next.tree.read(actual.root),await next.tree.read(independent.root));
 }
 assert.ok(Math.abs(measured[1]-measured[0])<250);
});
test('retaining streamed text preserves surrogate seams, controls and exact byte block boundaries',async()=>{
 let units='';for(let i=0;i<=65535;i++)units+=String.fromCharCode(i);
 for(const value of ['',units,...[32764,32765,32766,32767,32768,1048573].map(n=>'x'.repeat(n))]){
  const storage=memory(),tree=storage.tree();
  async function* chunks(){for(let i=0;i<value.length;i+=127)yield value.slice(i,i+127);}
  const root=await retainRecordText(storage,chunks());assert.equal(await tree.read(root),value);
  let encoded='';for await(const part of tree.json(root))encoded+=part;assert.equal(encoded,JSON.stringify(value));
  if(value.length>8192)assert.equal(root,await tree.retain(value),'Retained spelling and block identities match the existing writer');
 }
 let closed=false;const controller=new AbortController(),storage=memory();
 async function* cancelled(){try{yield 'first';controller.abort(Error('Stop projection'));yield 'second';}finally{closed=true;}}
 await assert.rejects(retainRecordText(storage,cancelled(),{signal:controller.signal}),/Stop projection/);assert.equal(closed,true);
 await assert.rejects(retainRecordText(storage,[42]),{code:'INVALID'});
});

test('unchanged projection owners reuse their retained values as record collections grow',async t=>{
 const measurements=[];
 for(const count of [257,2003]){
  const storage=memory(),record={...sampleNotebook().entries[0],body:'Original summary',sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Exact section '+i,body:'Preserved observation '.repeat(40)})),attempt:attemptFixture()};
  const original=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),prior=await retainedQueryProjection(original,recordRevision(record)),next=await original.replace(['status'],'completed');
  const items=next.items,before=storage.nodes.size;next.items=async function*(){throw Error('An unchanged projection owner was traversed');};storage.reads=0;storage.writes=0;
  const actual=await retainedQueryProjection(next,recordRevision({...record,status:'completed'}),{previous:{document:original,tree:storage.tree(),root:prior.root}});
  const measured={reads:storage.reads,writes:storage.writes,nodes:storage.nodes.size-before};measurements.push(measured);assert.ok(measured.reads<3000,`${count}: ${measured.reads} reads`);assert.ok(measured.writes<180,`${count}: ${measured.writes} writes`);
  t.diagnostic(`${count} prior sections: projection reused owners with ${measured.reads} reads, ${measured.writes} put calls and ${measured.nodes} new nodes`);
  next.items=items;const expected=await retainedQueryProjection(next,recordRevision({...record,status:'completed'}));
  assert.deepEqual(await storage.tree().read(actual.root),await storage.tree().read(expected.root));assert.deepEqual(await storage.tree().read(actual.summaryRoot),await storage.tree().read(expected.summaryRoot));
 }
 for(const key of ['reads','writes','nodes'])assert.ok(Math.abs(measurements[1][key]-measurements[0][key])<80,'Projection '+key+' grew with the unchanged collection');
});

test('projection reuse invalidates every changed source owner, including privacy and fallback labels',async()=>{
 const storage=memory(),book=sampleNotebook(),target={workspaceId:book.id,kind:'record',id:book.entries[1].id,revision:'a'.repeat(64)},record={...book.entries[0],body:'Original summary',
  sections:[{id:randomUUID(),title:'Section',body:'Original section'}],contributors:[{id:randomUUID(),name:'Observer',role:'Acquisition'}],tags:['Exact'],
  relations:[{id:randomUUID(),type:'Uses method',role:'uses-method',label:'Method',target}],
  attachments:[{id:randomUUID(),kind:'image',caption:'Public photograph',alt:'Evidence',share:true},{id:randomUUID(),kind:'image',caption:'Private photograph',alt:'Private',share:false}],
  figures:[{id:randomUUID(),title:'',points:[{x:1,y:2}]}],
  template:{id:randomUUID(),label:'Template',profileId:'general',fields:[{key:'exact',label:'Exact value'}],values:{exact:'0.0001'}},
  attempt:attemptFixture(),results:{version:1,statements:[{id:randomUUID(),title:'Result',text:'Observed',limitations:'Original limits'}]}
 };
 const document=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),prior=await retainedQueryProjection(document,recordRevision(record)),previous={document,tree:storage.tree(),root:prior.root};
 const cases=[
  [['title'],'New title used by an untitled figure'],[['status'],'completed'],[['tags'],['Later tag']],
  [['body'],{type:'doc',content:[{type:'heading',attrs:{id:randomUUID(),level:2},content:[{type:'text',text:'New heading'}]},{type:'paragraph',content:[{type:'text',text:'Linked record',marks:[{type:'link',attrs:{href:researchReference(target)}}]}]},{type:'book_figure',attrs:{figureId:record.attachments[0].id}}]}],
  [['sections','0','title'],'Amended section'],[['sections','0','body'],'Amended source prose'],[['contributors','0','name'],'Later observer'],
  [['relations','0','type'],'Reviewed source'],[['relations','0','label'],'Updated method label'],[['relations','0','target','revision'],'b'.repeat(64)],
  [['attachments','0','share'],false],[['attachments','1','share'],true],[['attachments','0','caption'],'Corrected caption'],[['figures','0','title'],'Named figure'],
  [['attachments'],[]],[['sections'],[]],[['template'],null],
  [['template','label'],'Changed type label'],[['template','fields','0','label'],'Changed field label'],[['template','values','exact'],'0.0002'],
  [['attempt','events','0','label'],'Revised event'],[['attempt','events','0','references'],[{...target,label:'Pinned acquisition reference'}]],
  [['results','statements','0','limitations'],'Changed limitation']
 ];
 for(const [path,value] of cases){
  const next=await document.replace(path,value),record=await next.tree.read(next.root),version=recordRevision(record),fresh=await retainedQueryProjection(next,version),reused=await retainedQueryProjection(next,version,{previous});
  assert.deepEqual(await next.tree.read(reused.root),await next.tree.read(fresh.root),path.join('.'));
  assert.deepEqual(await next.tree.read(reused.summaryRoot),await next.tree.read(fresh.summaryRoot),path.join('.'));
 }
 // Missing older optional projections rebuild from the original owner.
 const partial=await document.tree.retain({id:record.id,notebookId:record.notebookId}),fallback=await retainedQueryProjection(document,recordRevision(record),{previous:{...previous,root:partial}});
 assert.deepEqual(await document.tree.read(fallback.root),await document.tree.read(prior.root));
 const controller=new AbortController();controller.abort(Error('Stop projection reuse'));await assert.rejects(retainedQueryProjection(document,recordRevision(record),{previous,signal:controller.signal}),/Stop projection reuse/);
});

test('changed figure data and media transcripts do not enumerate or rebuild unchanged publication labels',async t=>{
 const measurements=[];
 for(const count of [257,2003]){
  const storage=memory(),record={...sampleNotebook().entries[0],body:'Unchanged',sections:[],
   figures:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Figure '+i,points:[{x:i,y:i+1}]})),
   attachments:Array.from({length:count},(_,i)=>({id:randomUUID(),kind:'image',caption:'Image '+i,alt:'Retained view',share:i%2===0,transcript:''}))};
  const original=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),prior=await retainedQueryProjection(original,recordRevision(record)),previous={document:original,tree:storage.tree(),root:prior.root};
  let next=await original.replace(['figures',String(count-1),'points'],[{x:1,y:2},{x:3,y:4}]);next=await next.replace(['attachments',String(count-2),'transcript'],'An amended transcription');
  const updated=await next.tree.read(next.root),revision=recordRevision(updated),items=next.items,before=storage.nodes.size;next.items=async function*(){throw Error('Unchanged publication dependencies enumerated a collection');};storage.reads=0;storage.writes=0;
  const result=await retainedQueryProjection(next,revision,{previous});measurements.push(storage.reads);t.diagnostic(`${count} figures and files: ${storage.reads} projection reads, ${storage.nodes.size-before} new nodes`);assert.ok(storage.reads<7000);
  next.items=items;const fresh=await retainedQueryProjection(next,revision);assert.deepEqual(await storage.tree().read(result.root),await storage.tree().read(fresh.root));
  for(const path of [['cardSources'],['publication'],['editionInventory','figures'],['editionInventory','attachments']])assert.equal((await storage.tree().select(result.root,path)).revision,(await storage.tree().select(prior.root,path)).revision);
 }
 assert.ok(Math.abs(measurements[1]-measurements[0])<800,'Changed-field dependency work must not enumerate the growing collections');
});

test('collection dependencies preserve order, presence and late edits across inline and retained representations',async()=>{
 const storage=memory(),record={sections:Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Old body'}))},original=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true});
 const matches=(next,fields)=>sameCollectionFields(next,original,{collection:['sections'],fields});
 const body=await original.replace(['sections','69','body'],'Changed body');assert.equal(await matches(body,['id','title']),true);assert.equal(await matches(body,['body']),false);
 const titled=await original.replace(['sections','69','title'],'Changed title');assert.equal(await matches(titled,['id']),true);assert.equal(await matches(titled,['title']),false);
 const present=await original.property(['sections','69'],'optional',null);assert.equal(await matches(present,['optional']),false);
 const appended=await original.splice(['sections'],70,0,[{id:randomUUID(),title:'Added',body:''}]);assert.equal(await matches(appended,['id']),false);
 const swapped=await original.replace(['sections'],[...record.sections.slice(1),record.sections[0]]);assert.equal(await matches(swapped,['id']),false);
 const padded=await original.replace(['sections','69','body'],'Retained source '.repeat(3000));assert.equal(await matches(padded,['id','title']),true);
 const removed=await original.property([],'sections',null,{remove:true});assert.equal(await matches(removed,['id']),false);
 await assert.rejects(sameCollectionFields(body,original,{collection:['sections'],fields:['id']},{signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('one-to-one projection edits update late slots without reading unchanged source or output values',async t=>{
 const measurements=[];
 for(const count of [257,2003]){
  const storage=memory(),record={id:randomUUID(),title:'Fallback title',figures:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Label '+i,points:[i]}))},project=item=>({id:item.id,title:item.title||record.title}),labels=record.figures.map(project);
  const original=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),priorRoot=await storage.tree().retain({labels}),previous={document:original,tree:storage.tree(),root:priorRoot},options={path:['labels'],collection:['figures'],fields:['id','title'],context:[['title']],project};
  let next=await original.replace(['figures',String(count-1),'title'],'Amended final label');next=await next.replace(['figures','2','points'],[4,5,6]);
  const read=next.tree.read.bind(next.tree),unselected=new Set();
  for(const position of [0,1,3])unselected.add(await next.reference(['figures',String(position)]));
  next.tree.read=async ref=>{assert.ok(!unselected.has(ref),'Read an unchanged source item');return read(ref);};storage.reads=0;storage.writes=0;
  const result=await mapRecordProjection(next,previous,options,()=>assert.fail('Unchanged slots rebuilt'));measurements.push(storage.reads);t.diagnostic(`${count} labels: ${storage.reads} reads and ${storage.writes} writes for one amended slot`);
  const expected=structuredClone(labels);expected[count-1].title='Amended final label';assert.deepEqual(await storage.tree().read(result),expected);assert.deepEqual(await storage.tree().selected(priorRoot,['labels']),{found:true,value:labels});
  let rebuilt=0;const rebuild=async()=>{rebuilt++;return 'rebuilt';};
  assert.equal(await mapRecordProjection(await next.replace(['title'],'New fallback'),previous,options,rebuild),'rebuilt');
  const added={id:randomUUID(),title:'Added',points:[]},appended=await next.splice(['figures'],count,0,[added]),extended=await mapRecordProjection(appended,previous,options,()=>assert.fail('Append rebuilt earlier labels'));assert.deepEqual(await storage.tree().read(extended),[...expected,project(added)]);
  const removed=await next.splice(['figures'],count-2,2,[]),shortened=await mapRecordProjection(removed,previous,options,()=>assert.fail('Removal rebuilt earlier labels'));assert.deepEqual(await storage.tree().read(shortened),labels.slice(0,-2));
  assert.equal(await mapRecordProjection(next,{...previous,root:await storage.tree().retain({})},options,rebuild),'rebuilt');assert.equal(rebuilt,2);
  await assert.rejects(mapRecordProjection(next,previous,options,rebuild,{signal:AbortSignal.abort()}),{name:'AbortError'});
 }
 assert.ok(Math.abs(measurements[1]-measurements[0])<80,'Selected mapping cost grew with unchanged items');
});

test('projection slots follow insertions, deletion to empty, reorder and changed inline encodings exactly',async()=>{
 const storage=memory(),rows=Array.from({length:65},(_,i)=>({id:randomUUID(),title:'Label '+i,data:'ignored'})),record={rows},document=new RecordDocument(storage,await storage.tree().retain(record),{mutable:true}),project=({id,title})=>({id,title}),prior=await storage.tree().retain({labels:rows.map(project)}),previous={document,tree:storage.tree(),root:prior},options={path:['labels'],collection:['rows'],fields:['id','title'],context:[],project};
 for(const next of [[],rows.slice(0,3),[rows[64],...rows.slice(0,64)],[{id:randomUUID(),title:'Inserted'},...rows],rows.map(row=>({...row,title:row.title+' changed'}))]){
  const edited=await document.replace(['rows'],next),result=await mapRecordProjection(edited,previous,options,()=>assert.fail('Existing mapping should be updated by position'));
  assert.deepEqual(await storage.tree().read(result),next.map(project));
 }
});

test('retained query projections preserve all shared semantics without assembling collection values',async()=>{
 const book=sampleNotebook(),target={workspaceId:book.id,kind:'record',id:book.entries[1].id,revision:'a'.repeat(64)};
 const headingId=randomUUID(),figureId=randomUUID(),imageId=randomUUID(),privateId=randomUUID();
 const prose={type:'doc',content:[
  {type:'heading',attrs:{level:2,id:headingId},content:[{type:'text',text:'ΟΣ Ι İ Exact heading'}]},
  {type:'paragraph',content:[{type:'text',text:'Pinned method',marks:[{type:'link',attrs:{href:researchReference(target)}}]}]},
  {type:'book_figure',attrs:{figureId}},{type:'book_figure',attrs:{figureId:imageId}},{type:'book_figure',attrs:{figureId:privateId}}
 ]};
 const record={...book.entries[0],body:prose,outcome:'kept',
  tags:Array.from({length:1025},(_,i)=>'Preserved tag '+i),
  sections:Array.from({length:1200},(_,i)=>({id:randomUUID(),title:'Section '+i+' ΟΣ',body:i===1199?prose:'Exact '+i+' '+('value '.repeat(30))})),
  contributors:[{id:randomUUID(),name:'Observer',role:'Acquisition'}],
  relations:[{id:randomUUID(),type:'Uses method',role:'uses-method',label:'Method',target},{id:randomUUID(),type:'Uses method',role:'uses-method',label:'Same target',target}],
  attachments:[{id:imageId,kind:'image',caption:'Public figure',alt:'Public image',share:true},{id:privateId,kind:'image',caption:'Private figure',alt:'Private image',share:false},{id:randomUUID(),kind:'audio',caption:'Sound',alt:'',share:true}],
  figures:[{id:figureId,title:'Native figure',points:Array.from({length:4000},(_,i)=>({x:i,y:i+1}))}],
  template:{id:randomUUID(),label:'Template',profileId:'general',fields:[{key:'exact',label:'Exact value'},...Array.from({length:257},(_,i)=>({key:'value'+i,label:'Measurement '+i}))],values:{exact:'-0.0000001',number:42,...Object.fromEntries(Array.from({length:257},(_,i)=>['value'+i,'exact retained '+i]))}},
  results:{version:1,statements:[{id:randomUUID(),title:'Conclusion',text:'Results',limitations:'Incomplete context'}]},
  attempt:{version:1,preparations:[],assessments:[],events:[{kind:'run',label:'Acquisition',extent:'complete',context:'local',circumstances:'A test',actor:'Observer',source:'Original',time:{value:'t=1'},reason:'',references:[{...target,label:'Pinned method'}]}]}
 };
 const storage=memory(),tree=storage.tree(),root=await tree.retain(record),document=new RecordDocument(storage,root),version=recordRevision(record);
 const read=document.tree.read.bind(document.tree),forbidden=new Set([root]);
 for(const name of ['sections','attachments','contributors','relations','figures','tags','attempt']){const selected=await tree.select(root,[name]);if(!selected.inline)forbidden.add(selected.revision);}
 const field=document.field.bind(document);document.field=async(path,...options)=>{assert.ok(path.join()!=='attempt','Projection assembled the run history');return field(path,...options);};
 for(const path of [['template'],['template','fields'],['template','values']]){const selected=await tree.select(root,path);if(!selected.inline)forbidden.add(selected.revision);}
 document.tree.read=async revision=>{assert.ok(!forbidden.has(revision),'Projection assembled a record collection');return read(revision);};
 const result=await retainedQueryProjection(document,version),actual=await tree.read(result.root);
 const expected={...recordQueryDocument(record),publication:recordPublicationSummary(record),publicationCard:publicationCard(record),publicationDescriptor:publicationDescriptor(record),editionInventory:recordEditionInventory(record,version),recordRevision:version};
 assert.deepEqual(actual,expected);
 const {searchText,referenceTargets,cardSources,publication,publicationCard:card,publicationDescriptor:descriptor,editionInventory,...browse}=expected;
 assert.deepEqual(await tree.read(result.summaryRoot),browse);assert.ok(searchText.includes('section 1199'));assert.equal(referenceTargets.length,3);
 assert.equal(cardSources.sections.length,1200);assert.equal(publication.attachments.length,3);assert.equal(card.attachments.length,2);assert.equal(descriptor.attachments.length,1);assert.equal(editionInventory.sections.length,1200);
});
