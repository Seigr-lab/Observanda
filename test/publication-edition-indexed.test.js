import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {publicationInputPlan,publicationInputContext} from '../src/publication-edition-projection.js';
import {buildPublication} from '../src/publication.js';
import {contentBuffer} from '../src/file-content.js';
import {defaultFeed} from '../src/web/website-feed-model.js';
import {feedFilePath} from '../src/publication-feeds.js';
import {MediaStore} from '../src/media.js';
import {RecordDocument} from '../src/record-document.js';
import {WebsiteEditorStore} from '../src/website-editor-store.js';
import {publicationDraftCommand} from './publication-fixture.js';
import {PublicationFragments} from '../src/publication-edition-fragments.js';
import {withPublicationOutputWriter} from '../src/publication-output.js';
import {PublicationOutputBuffer} from '../src/publication-output-buffer.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {digest} from '../src/storage-format.js';

// One native source/edition journey covers late selected values and all public
// continuation families. Existing owner fixtures supply encryption and storage.
test('indexed editions stream selected pages, menus, feeds and references after the draft is discarded',{timeout:180000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-indexed-render-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:38},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Result '+String(index).padStart(2,'0'),share:true,body:'Exact selected result '+index,sections:[],figures:[],attachments:[],relations:[]}));
 for(const record of book.entries.slice(1))record.relations=[{id:randomUUID(),type:'References',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id},label:book.entries[0].title}];
 const fixture=await encryptedFixture(directory,book);t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-indexed-render-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const storage=websiteWorkspace(fixture.workspace,null),editor=new WebsiteEditor(fixture.workspace),execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId:null,...data}),releases=new PublicationJobs(storage);
 const pages=Array.from({length:31},(_,index)=>({id:randomUUID(),title:'Page '+String(index).padStart(2,'0'),body:'Exact page teaser '+index,share:true,sections:[]})),late=pages.at(-1),hidden={id:randomUUID(),title:'Excluded private page',body:'Excluded private page body',share:false,sections:[]};
 const image=await new MediaStore(fixture.workspace).import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'),'image');
 const sections=[{id:'results',kind:'records',title:'Results',show:true,layout:'list',feed:{...defaultFeed('records'),pageSize:5,visitorFilters:true,visitorOrder:true}},{id:'pages',kind:'pages',title:'Pages',show:true,layout:'list',feed:{...defaultFeed('pages'),pageSize:7,visitorFilters:true,visitorOrder:true}}];
 const layout={target:'page:'+late.id,showHeading:true,heading:'Exact late heading',description:'',placement:'before',sections:[{id:'retained-asset',kind:'asset',title:'Retained image',show:true,assetId:image.id}]};
 const navigation=pages.map((page,index)=>({target:'page:'+page.id,label:'Menu '+String(index).padStart(2,'0'),show:true,parent:index?'page:'+pages[0].id:null}));
 let state=await execute('open');const change=async operations=>{state=await execute('change',{websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations});};
 await change([{type:'append',collection:'pages',values:[...pages,hidden]},{type:'append',collection:'navigation',values:navigation},{type:'append',collection:'assets',values:[{...image,caption:'Exact retained image',alt:'Blue retained image',transcript:''}]},{type:'replace',collection:'layouts',key:layout.target,value:layout},{type:'replace',collection:'branding',key:'home',value:{target:'home',logos:[]}},{type:'settings',path:['document','website','home'],value:{enabled:true,title:'Home',introduction:'Retained edition',showTitle:true,sections}}]);
 const command={etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft:{id:state.draft.id,revision:state.draft.revision}},field=RecordDocument.prototype.field,document=WebsiteEditorStore.prototype.document;
 const forbidden=new Set(['document/pages','document/website/navigation','document/website/assets','document/website/layouts','document/branding']);
 RecordDocument.prototype.field=function(path,...args){assert.equal(forbidden.has(path.join('/')),false,'capture hydrated a growing website collection');return field.call(this,path,...args);};
 WebsiteEditorStore.prototype.document=async function(...args){const selected=await document.apply(this,args),read=selected.document.tree.read.bind(selected.document.tree);selected.document.tree.read=async revision=>{assert.notEqual(revision,selected.document.root,'capture hydrated the entire website');return read(revision);};return selected;};
 let source;try{source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const source=await releases.pin(command,{workspace,id,signal:t.signal});return finish(()=>source);},{signal:t.signal});}finally{RecordDocument.prototype.field=field;WebsiteEditorStore.prototype.document=document;}
 assert.equal(source.version,6);assert.equal(Object.hasOwn(source,'records'),false);const input=await openPublicationInput(storage,source),header=await input.metadata();for(const key of ['projects','notebooks','pages','branding'])assert.deepEqual(header[key],[]);for(const key of ['navigation','assets','layouts'])assert.deepEqual(header.website[key],[]);
 const plan=await publicationInputPlan(input,'home'),projection=await publicationInputContext(input,plan);assert.ok(plan.values.pages.size<=1);assert.ok(plan.values.records.size<=1);assert.ok(projection.context.pages.length<=1);assert.equal(await input.count('pages',{shared:true}),31);
 await execute('discard',{draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
 const job={id:source.id,lease:{token:randomUUID()}},candidate=await releases.prepare(job,{signal:t.signal,progress:async()=>{}});await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId);
 const text=async name=>(await contentBuffer(await edition.files.get(name))).toString(),home=await text('index.html'),lateHTML=await text('pages/'+late.id+'.html');assert.match(lateHTML,/Exact late heading/);assert.match(lateHTML,/Exact page teaser 30/);assert.match(lateHTML,/Retained image/);assert.ok(await edition.files.has('media/'+image.id+'.png'));assert.equal(await edition.files.has('pages/'+hidden.id+'.html'),false);assert.doesNotMatch(home,/Excluded private page/);assert.match(home,/Menu 30/);assert.match(home,/site-submenu/);
 assert.ok(await edition.files.has('browse-1.html'));assert.ok(await edition.files.has('entries/references-'+book.entries[0].id+'-1.html'));assert.match(await text('entries/references-'+book.entries[0].id+'-1.html'),/Result 37/);
 const expectedBook={...book,pages:[...pages,hidden],branding:[{target:'home',logos:[]}],website:{...book.website,home:{enabled:true,title:'Home',introduction:'Retained edition',showTitle:true,sections},navigation,assets:[{...image,caption:'Exact retained image',alt:'Blue retained image',transcript:''}],layouts:[layout]}};
 const expected=buildPublication(expectedBook,{mediaFiles:await new MediaStore(fixture.workspace).publicFiles(expectedBook,{streamed:true})});let feedCount=0;
 for await(const name of edition.files.keys())if(feedFilePath(name)){feedCount++;assert.equal(await text(name),expected.files.get(name),name);}assert.equal(feedCount,8+5);
 const choices=await releases.pageChoices(edition,{path:'pages/'+late.id+'.html',limit:2});assert.equal(choices.items[0].path,'pages/'+late.id+'.html');assert.ok(choices.offset>24);assert.ok(choices.total>31);
});


test('lazy feed cards retain cover styles and replay unchanged fragments without changing fallback pages',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-lazy-cards-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:4},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Selected cover '+index,share:true,body:'Retained observation '+index,sections:[],figures:[],attachments:[],relations:[]}));
 book.notebooks=book.notebooks.filter(item=>item.id===seed.notebookId);book.projects=book.projects.filter(item=>item.id===book.notebooks[0].projectId);
 const fixture=await encryptedFixture(directory,book);t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-lazy-cards-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const storage=websiteWorkspace(fixture.workspace,null),releases=new PublicationJobs(storage),media=new MediaStore(fixture.workspace),image=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'),'image');
 for(const record of book.entries)record.attachments=[{...image,caption:'Retained cover',alt:'Blue observation',transcript:'',share:true}];
 book.entries.push({...structuredClone(seed),id:randomUUID(),title:'WITHHELD_RESULT',body:'WITHHELD_BODY',share:false,sections:[],figures:[],attachments:[],relations:[]});
 const section=(id,pageSize)=>({id,kind:'records',title:id,show:true,layout:'list',...(pageSize?{feed:{...defaultFeed('records'),pageSize,visitorFilters:true}}:{})});
 book.website.home={enabled:true,title:'Retained covers',introduction:'Complete composition',showTitle:true,sections:[section('first-feed',1),section('second-feed',2),section('all-selected')]};
 // No eager project/book card render may supply the streamed cover CSS.
 book.website.layouts=['project:'+book.projects[0].id,'notebook:'+book.notebooks[0].id].map(target=>({target,showHeading:true,heading:'Selected collection',description:'',placement:'replace',sections:[{id:'intro',kind:'text',title:'Collection introduction',body:'Use the selected home feeds.',show:true}]}));
 book.website.presentation={covers:[],media:book.entries.filter(record=>record.share).map((record,index)=>({scope:'cover:'+record.id,id:image.id,width:37+index,ratio:'square',fit:'cover',link:'',target:'_self'}))};
 const command=await publicationDraftCommand(fixture.workspace,book),source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const selected=await releases.pin(command,{workspace,id,signal:t.signal});return finish(()=>selected);},{signal:t.signal});
 const expected=buildPublication(book,{mediaFiles:await media.publicFiles(book,{streamed:true})}),add=PublicationFragments.prototype.add,reads=[];
 PublicationFragments.prototype.add=function(read){const item={calls:0};reads.push(item);return add.call(this,()=>{item.calls++;return read();});};
 let candidate;const job={id:source.id,lease:{token:randomUUID()}};
 try{candidate=await releases.prepare(job,{signal:t.signal,progress:async()=>{}});}finally{PublicationFragments.prototype.add=add;}
 assert.ok(reads.length>3);assert.ok(reads.every(item=>item.calls<=1),'A sibling continuation rerendered an invariant fragment');
 await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId),text=async name=>(await contentBuffer(await edition.files.get(name))).toString();
 const css=await text('styles.css');
 for(const [index,record] of book.entries.filter(record=>record.share).entries()){
  const selector='[data-media-scope="cover:'+record.id+'"][data-media-id="'+image.id+'"]';
  for(const rule of [selector+'{width:'+(37+index)+'%;margin-inline:auto}',selector+' img,'+selector+' video{aspect-ratio:1;object-fit:cover;width:100%}'])assert.equal(css.split(rule).length-1,1,'Missing or duplicated retained cover rule: '+rule);
 }
 let feeds=0;
 for await(const name of edition.files.keys())if(name.endsWith('.html')){
  const html=await text(name);if(name==='index.html'||feedFilePath(name))assert.equal(html,expected.files.get(name),name);assert.doesNotMatch(html,/WITHHELD_RESULT|WITHHELD_BODY/);if(feedFilePath(name))feeds++;
  if(/^(projects|notebooks)\//.test(name)){assert.match(html,/Use the selected home feeds/);assert.doesNotMatch(html,/data-record-id=/);}
 }
 assert.equal(feeds,6);assert.ok(await edition.files.has('media/'+image.id+'.png'));
 // An unfinished replay cannot become cached success; the same existing
 // scratch owner cleans it before another page reuses the logical key.
 const attempt={id:source.id,lease:{token:randomUUID()}},outputDirectory=await releases.directory(attempt.id,attempt.lease.token),failure=new Error('Interrupted fragment'),payload=Buffer.from('Exact selected fragment '.repeat(8000));let closed=false,escaped;
 await withPublicationOutputWriter(storage,source,attempt,{directory:outputDirectory,signal:t.signal},async writer=>{
  await assert.rejects(writer.withFragments(async replay=>{
   escaped=replay;
   async function* broken(){try{yield payload;throw failure;}finally{closed=true;}}
   for await(const chunk of replay('same-key',broken))assert.ok(chunk.length<=64*1024);
  }),error=>error===failure);assert.equal(closed,true);
  await assert.rejects(escaped('same-key',async function*(){yield 'stale';}).next(),{code:'INVALID'});
  await writer.withFragments(async replay=>{
   let produced=0;async function* content(){produced++;yield payload;}
   for(let pass=0;pass<2;pass++)assert.deepEqual(Buffer.concat(await Array.fromAsync(replay('same-key',content))),payload);
   assert.equal(produced,1);
  });assert.equal(writer.count(),0,'Scratch fragments leaked into retained public files');
 });
 const controller=new AbortController(),cancelled={id:source.id,lease:{token:randomUUID()}},cancelDirectory=await releases.directory(cancelled.id,cancelled.lease.token);closed=false;
 await assert.rejects(withPublicationOutputWriter(storage,source,cancelled,{directory:cancelDirectory,signal:controller.signal},writer=>writer.withFragments(async replay=>{
  async function* content(){try{yield payload;yield payload;}finally{closed=true;}}
  const iterator=replay('cancelled',content);await iterator.next();controller.abort(failure);await iterator.next();
 })),error=>error===failure);assert.equal(closed,true);
});


test('static feed continuations preserve each owning backlink window and single-window identities',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-reference-feeds-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:26},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Referenced observation '+String(index).padStart(2,'0'),share:true,body:'Exact authored observation '+index,sections:[],figures:[],attachments:[],relations:[]}));
 const target=book.entries[0],single=book.entries[1];
 for(const record of book.entries.slice(1))record.relations=[{id:randomUUID(),type:'References',target:{workspaceId:book.id,kind:'record',id:target.id},label:target.title}];
 const fixture=await encryptedFixture(directory,book);t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-reference-feeds-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const footer=createRegion(book.website,'footer','More observations',{makeId:randomUUID});footer.sections=[{id:'related-feed',kind:'records',title:'More observations',show:true,layout:'list',filter:{projectId:null,tag:'',limit:2},feed:{...defaultFeed('records'),pageSize:1}}];
 for(const record of [target,single])assignRegion(book.website,'entry:'+record.id,'footer',footer.id);
 const command=await publicationDraftCommand(fixture.workspace,book),storage=websiteWorkspace(fixture.workspace,null),releases=new PublicationJobs(storage),source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const selected=await releases.pin(command,{workspace,id,signal:t.signal});return finish(()=>selected);},{signal:t.signal});
 const job={id:source.id,lease:{token:randomUUID()}},candidate=await releases.prepare(job,{signal:t.signal,progress:async()=>{}});await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId),expected=buildPublication(book);
 const references=html=>/<div id="record-references">[\s\S]*?<\/nav><\/div>/.exec(html)?.[0],feedId=html=>/data-public-feed="([a-f0-9]+)"/.exec(html)?.[1];
 for(const [label,read] of [['retained',async name=>(await contentBuffer(await edition.files.get(name))).toString()],['synchronous',async name=>expected.files.get(name)]]){
  const ids=[],seen=new Set();
  for(let window=0;window<2;window++){
   const name='entries/'+(window?'references-'+target.id+'-'+window:target.id)+'.html',html=await read(name),context=references(html);assert.ok(context,label+' '+name);
   const backlinks=[...context.matchAll(/href="\.\.\/entries\/([a-f0-9-]+)\.html"/g)].map(match=>match[1]);assert.equal(backlinks.length,window?1:24);for(const id of backlinks)seen.add(id);
   const id=feedId(html);assert.ok(id);ids.push(id);
   const next=/<a data-feed-next href="([^"]+)"/.exec(html)[1],nextName=path.posix.join('entries',next.split('#')[0]),continued=await read(nextName);
   assert.equal(references(continued),context,label+' Next feed changed the owning backlink window');assert.equal(feedId(continued),id);assert.match(continued,/Exact authored observation 0/);
   const previous=/<a data-feed-previous href="([^"]+)"/.exec(continued)[1],first=await read(path.posix.join('entries',previous.split('#')[0]));assert.equal(references(first),context,label+' Previous feed changed backlink context');
   assert.notEqual(/data-feed-id="([^"]+)"/.exec(html)[1],/data-feed-id="([^"]+)"/.exec(continued)[1]);
  }
  assert.equal(new Set(ids).size,2);assert.deepEqual(seen,new Set(book.entries.slice(1).map(record=>record.id)));
  const ordinary=await read('entries/'+single.id+'.html');assert.equal(feedId(ordinary),digest('entry:'+single.id+'#footer:related-feed'),'A one-window feed path changed');
 }
 let feedCount=0;for await(const name of edition.files.keys())if(feedFilePath(name))feedCount++;assert.equal(feedCount,6);
});


test('composed static editions preserve complete large fallback pages with bounded replay at two scales',{timeout:180000},async t=>{
 const identities=new Set(),measurements=[];
 for(const [scale,shape] of [{records:8,feeds:3,targets:1,texts:5,characters:54000},{records:12,feeds:4,targets:2,texts:6,characters:48000}].entries()){
  const phaseTimes={},started=performance.now();let phaseStarted=started;const phase=name=>{const now=performance.now();phaseTimes[name]=Math.round(now-phaseStarted);phaseStarted=now;console.log(JSON.stringify({scale,phase:name,milliseconds:phaseTimes[name],elapsedMs:Math.round(now-started)}));};
  const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-composed-output-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],marker='COMPOSED_SCALE_'+scale;
  book.notebooks=book.notebooks.filter(item=>item.id===seed.notebookId);book.projects=book.projects.filter(item=>item.id===book.notebooks[0].projectId);
  book.entries=Array.from({length:shape.records},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:marker+' result '+String(index).padStart(2,'0'),body:'Exact selected observation '+index,share:true,sections:[{id:randomUUID(),title:'PRIVATE_SECTION_ONLY',body:'PRIVATE_SECTION_BODY',share:false}],attachments:[],figures:[],relations:[]}));
  const withheld={...structuredClone(seed),id:randomUUID(),title:'PRIVATE_RECORD_ONLY',body:'PRIVATE_RECORD_BODY',share:false,sections:[],attachments:[],figures:[],relations:[]},excluded={...withheld,id:randomUUID(),title:'SITE_EXCLUDED_RECORD',body:'SITE_EXCLUDED_BODY',share:true};book.entries.push(withheld,excluded);
  const feeds=Array.from({length:shape.feeds},(_,index)=>({id:'feed-'+index,kind:'records',title:'Independent feed '+index,show:true,layout:'list',feed:{...defaultFeed('records'),order:index%2?'oldest':'newest',pageSize:index+2,visitorFilters:true,visitorOrder:true}}));
  const texts=Array.from({length:shape.texts},(_,index)=>({id:'invariant-'+index,kind:'text',title:marker+' invariant '+index,show:true,body:(marker+' exact invariant text '+index+'. ').repeat(Math.ceil(shape.characters/40)).slice(0,shape.characters).trim()})),sections=[...texts,...feeds,{id:'all-selected',kind:'records',title:'Every selected observation',show:true,layout:'list'}];
  book.website.home={enabled:true,title:marker+' home',introduction:'Complete no-script composition',showTitle:true,sections};book.website.navigation=[];book.website.layouts=[];
  const pages=Array.from({length:shape.targets-1},(_,index)=>({id:randomUUID(),title:marker+' page '+index,body:'Exact independent page body',share:true,sections:structuredClone(sections)})),privatePage={id:randomUUID(),title:'PRIVATE_PAGE_ONLY',body:'PRIVATE_PAGE_BODY',share:false,sections:[]};book.pages=[...pages,privatePage];
  const fixture=await encryptedFixture(directory,book);t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-composed-output-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});phase('fixture');
  const storage=websiteWorkspace(fixture.workspace,null),releases=new PublicationJobs(storage),base=await publicationDraftCommand(fixture.workspace,book),editor=new WebsiteEditor(fixture.workspace),state=await editor.execute('change',{workspaceId:book.id,websiteId:null,websitePin:base.websitePin,draftId:base.websiteDraft.id,expectedRevision:base.websiteDraft.revision,commandId:randomUUID(),operations:[{type:'settings',path:['selection'],value:{defaultShare:false,includeProjects:[],records:book.entries.map(record=>({id:record.id,share:record.share&&record.id!==excluded.id,attachments:[]}))}}]});
  phase('authoring');
  const command={etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft:{id:state.draft.id,revision:state.draft.revision}},source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const value=await releases.pin(command,{workspace,id,signal:t.signal});return finish(()=>value);},{signal:t.signal});
  phase('capture');
  assert.equal(source.version,6);assert.equal(source.etag,command.etag);assert.deepEqual(source.websitePin,command.websitePin);assert.equal(identities.has(source.id),false);identities.add(source.id);
  const input=await openPublicationInput(storage,source);assert.equal(await input.recordCount(),shape.records);assert.equal(await input.count('pages',{shared:true}),pages.length);
  const expectedBook=structuredClone(book);expectedBook.entries.find(record=>record.id===excluded.id).share=false;const expected=buildPublication(expectedBook),targets=new Map([['home','index.html'],...pages.map(page=>['page:'+page.id,'pages/'+page.id+'.html'])]);
  phase('source-and-synchronous-oracle');
  const owners=new Map(),buffers=new Set(),stats={defaultCards:0,activeCards:0,activeProducers:0,maximumBuffer:0,maximumChunk:0,streamedFiles:0,bufferedFiles:0},add=PublicationFragments.prototype.add,expand=PublicationFragments.prototype.expand,prepare=PublicationOutputBuffer.prototype.prepare;
  const owner=fragments=>{let value=owners.get(fragments);if(!value){value={target:null,parts:[],expansions:0,defaultCards:0,activeCards:0,activeProducers:0};owners.set(fragments,value);}return value;};
  const cardCount=chunk=>(String(chunk).match(/data-record-id=/g)??[]).length;
  PublicationFragments.prototype.add=function(read){const value=owner(this),part={calls:0};value.parts.push(part);return add.call(this,async function*(){part.calls++;for await(const chunk of read()){const count=cardCount(chunk);value.defaultCards+=count;stats.defaultCards+=count;yield chunk;}});};
  PublicationFragments.prototype.expand=function(html,overrides=new Map()){
   const value=owner(this),target=/data-page="([^"]+)"/.exec(html)?.[1];if(value.target!==null)assert.equal(target,value.target);value.target=target;value.expansions++;
   const measured=new Map([...overrides].map(([token,read])=>[token,async function*(){value.activeProducers++;stats.activeProducers++;for await(const chunk of read()){const count=cardCount(chunk);value.activeCards+=count;stats.activeCards+=count;yield chunk;}}]));return expand.call(this,html,measured);
  };
  PublicationOutputBuffer.prototype.prepare=async function(content,options){
   if(!buffers.has(this)){buffers.add(this);let held=this.bytes;Object.defineProperty(this,'bytes',{configurable:true,get:()=>held,set:value=>{held=value;stats.maximumBuffer=Math.max(stats.maximumBuffer,value);assert.ok(value>=0&&value<=1024*1024,'Output buffering exceeded its shared one-MiB bound');}});}
   const measured=(async function*(){for await(const chunk of content){stats.maximumChunk=Math.max(stats.maximumChunk,Buffer.byteLength(chunk));yield chunk;}})(),result=await prepare.call(this,measured,options);stats[result.buffered?'bufferedFiles':'streamedFiles']++;return result;
  };
  const job={id:source.id,lease:{token:randomUUID()}};let candidate;
  try{candidate=await releases.prepare(job,{signal:t.signal,progress:async value=>{console.log(JSON.stringify({scale,phase:'prepare-progress',...value,elapsedMs:Math.round(performance.now()-phaseStarted)}));}});}finally{PublicationFragments.prototype.add=add;PublicationFragments.prototype.expand=expand;PublicationOutputBuffer.prototype.prepare=prepare;}
  phase('prepare');
  assert.ok(buffers.size);assert.ok([...buffers].every(value=>value.bytes===0),'Completed output retained buffered chunks');assert.ok(stats.maximumBuffer>=256*1024&&stats.maximumBuffer<=1024*1024);assert.ok(stats.maximumChunk<=64*1024);
  const fallbackPerTarget=feeds.reduce((sum,section)=>sum+Math.ceil(shape.records/section.feed.pageSize),0),defaultCards=shape.records+feeds.reduce((sum,section)=>sum+Math.min(shape.records,section.feed.pageSize),0);
  for(const target of targets.keys()){
   const values=[...owners.values()].filter(value=>value.target===target);assert.equal(values.length,1,'A composed target acquired multiple replay owners');const value=values[0];
   assert.equal(value.expansions,1+fallbackPerTarget);assert.equal(value.defaultCards,defaultCards);assert.equal(value.activeCards,shape.records*shape.feeds);assert.equal(value.activeProducers,fallbackPerTarget);
   assert.equal(value.parts.filter(part=>part.calls===1).length,shape.feeds+2);assert.ok(value.parts.every(part=>part.calls<=1),'A sibling feed reran an invariant producer');
  }
  assert.equal(stats.defaultCards,shape.targets*defaultCards);assert.equal(stats.activeCards,shape.targets*shape.records*shape.feeds);assert.ok(stats.streamedFiles>=shape.targets*(fallbackPerTarget+1),'Large HTML did not take the streaming output path');
  await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId);assert.deepEqual(edition.websitePin,source.websitePin);assert.equal(edition.etag,source.etag);assert.equal(edition.source.jobId,source.id);assert.deepEqual(edition.source.document,source.document);assert.deepEqual((await releases.source(source.id)).document,source.document);
  phase('commit-and-reopen');
  const htmlPaths=[],feedPaths=[],selectedIds=book.entries.filter(record=>record.share&&record.id!==excluded.id).map(record=>record.id).sort();let outputBytes=0,minimumComposedBytes=Infinity,maximumComposedBytes=0;
  for await(const [name,content] of edition.files)if(name.endsWith('.html')){
   const bytes=await contentBuffer(content),html=bytes.toString();htmlPaths.push(name);outputBytes+=bytes.length;assert.doesNotMatch(html,/PRIVATE_RECORD_ONLY|PRIVATE_RECORD_BODY|PRIVATE_SECTION_ONLY|PRIVATE_SECTION_BODY|PRIVATE_PAGE_ONLY|PRIVATE_PAGE_BODY|SITE_EXCLUDED_RECORD|SITE_EXCLUDED_BODY/);
   if(scale)assert.doesNotMatch(html,/COMPOSED_SCALE_0/,'A previous source identity leaked into another retained edition');
   if(targets.has(/data-page="([^"]+)"/.exec(html)?.[1])){
    assert.ok(bytes.length>256*1024,name+' must exceed the complete-file buffering threshold');minimumComposedBytes=Math.min(minimumComposedBytes,bytes.length);maximumComposedBytes=Math.max(maximumComposedBytes,bytes.length);
    assert.equal(html,expected.files.get(name),name+' lost or changed its complete no-script composition');
    for(const section of texts)assert.ok(html.includes(section.body),'Invariant authored text was truncated');
    const unpaged=html.slice(html.indexOf('data-section-id="all-selected"'));assert.deepEqual([...unpaged.matchAll(/data-record-id="([a-f0-9-]+)"/g)].map(match=>match[1]).sort(),selectedIds,'The unpaged collection lost selected records');
   }
   if(feedFilePath(name))feedPaths.push(name);
  }
  assert.equal(feedPaths.length,shape.targets*fallbackPerTarget);assert.deepEqual(feedPaths.sort(),[...expected.files.keys()].filter(feedFilePath).sort());assert.equal(await edition.files.has('pages/'+privatePage.id+'.html'),false);
  phase('verify-output');
  const measurement={scale,selectedRecords:shape.records,feeds:shape.feeds,composedTargets:shape.targets,htmlFiles:htmlPaths.length,feedFiles:feedPaths.length,outputBytes,minimumComposedBytes,maximumComposedBytes,...stats,phaseTimes};measurements.push(measurement);t.diagnostic(JSON.stringify(measurement));
 }
 assert.equal(identities.size,2);assert.ok(measurements[1].outputBytes>measurements[0].outputBytes);assert.ok(measurements[1].activeCards>measurements[0].activeCards);
});
