import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {moduleDomainOwner} from '../src/module-domain-owner.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfCrossReference} from '../src/web/pdf-cross-reference-model.js';
import {pdfNoteCall} from '../src/web/pdf-notes-model.js';
import {pdfFileResearch,projectPdfSection} from '../src/pdf-publication-files.js';
import {PdfLibraryOrganization} from '../src/pdf-library-organization.js';

function setup(){
 const workspace={projectId:randomUUID(),vault:{id:randomUUID()}},namespaceId=randomUUID(),owner=moduleDomainOwner(workspace,namespaceId);
 const values=new Map([['owner',{...owner,domain:'pdf',vaultId:workspace.vault.id}]]),reads=[];
 const store={domain:'pdf',workspace,namespaceId,writable:true,object:async key=>{reads.push(key);return structuredClone(values.get(key)??null);},putObject:async(key,value)=>{values.set(key,structuredClone(value));},deleteObject:async key=>values.delete(key),async *objectIdEntries(prefix){for(const key of values.keys())if(key.startsWith(prefix))yield key;}};
 const docs=new PdfDocumentStore(store),titles=[];
 const change=(id,revision,operation)=>docs.change({id,expectedRevision:revision,commandId:randomUUID(),operation});
 return {store,values,reads,docs,titles,change};
}
test('owner-local tags and collections keep ordered membership through edits, archive, recovery and replay',async()=>{
 const {docs,values,change}=setup(),documents=[];
 for(let i=0;i<3;i++){
  const id=randomUUID(),header={version:1,id,name:i===2?'Zinc':'Zinc survey',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
  const section={id:randomUUID(),title:'Site '+i,content:'Observation '+i,layout:null,start:null};
  const {revision}=await change(id,null,{type:'create',header,section});documents.push({id,revision,header});
 }
 await docs.prepareLibrary();
 const organize=async()=>new PdfLibraryOrganization(docs,(await docs.directory()).library);
 const edit=async(operation,commandId=randomUUID())=>(await organize()).edit({commandId,operation});
 const batch=async(action,items,groupId=null)=>{
  const review={action,selection:items.map(({id,revision})=>({id,revision})),groupId};
  const response=await (await organize()).review(review);
  return {review,token:response.token,commandId:randomUUID()};
 };
 const apply=async command=>(await organize()).apply(command);
 const tag=await edit({type:'create',id:randomUUID(),kind:'tag',name:'Zinc'});
 const create={type:'create',id:randomUUID(),kind:'collection',name:'Zinc'},key=randomUUID(),collection=await edit(create,key);
 assert.deepEqual(await edit(create,key),collection);assert.equal(values.get('owner').pdfFormat,8);
 await assert.rejects(edit({...create,name:'other'},key),{code:'MODULE_REPLAY'});
 await assert.rejects(edit({...create,id:randomUUID(),name:'zinc'}),{code:'PDF_LIBRARY_NAME_USED'});
 const assign=await batch('assign',documents,collection.id);assert.deepEqual(await apply(assign),{count:3});assert.deepEqual(await apply(assign),{count:3});
 await apply(await batch('assign',documents.slice(0,1),tag.id));
 const rename=await edit({type:'rename',id:collection.id,expected:collection.revision,name:'Field results'});
 const search={kind:'collection',search:'fie',cursor:null,limit:10};
 assert.deepEqual((await (await organize()).labels(search)).items,[{id:collection.id,name:'Field results',kind:'collection',revision:rename.revision,count:3}]);
 await assert.rejects(edit({type:'remove',id:collection.id,expected:rename.revision}),{code:'PDF_LIBRARY_GROUP_USED'});
 let command=await batch('pin',documents);const entry=documents[0];
 entry.revision=(await change(entry.id,entry.revision,{type:'header',header:{...entry.header,name:'Arsenic'}})).revision;
 await assert.rejects(apply(command),{code:'CONFLICT'});
 assert.deepEqual((await docs.libraryQuery({groupId:collection.id,sort:'pinned'})).items,[]);
 await apply(await batch('pin',documents));assert.equal((await docs.libraryQuery({groupId:collection.id,sort:'pinned'})).items[0].name,'Arsenic');
 assert.equal((await docs.libraryQuery({groupId:tag.id,search:'arse'})).items[0].revision,entry.revision);
 assert.deepEqual((await docs.libraryQuery({groupId:tag.id,search:documents[1].id})).items,[]);
 const selection=documents.map(({id,revision})=>({id,revision})),review=await (await organize()).review({action:'export',selection,groupId:null});
 for(const item of review.items){assert.equal(item.included,1);assert.equal(item.state,'ready');assert.equal(item.profile,'standard');assert.ok(item.sources);}
 await apply(await batch('archive',documents));
 const archived=(await docs.libraryQuery({groupId:collection.id,archived:true})).items;
 assert.equal(archived.length,3);assert.equal((await docs.libraryQuery({groupId:collection.id})).items.length,0);
 await apply(await batch('restore',archived));assert.equal((await docs.libraryQuery({groupId:tag.id})).items.length,1);
 const active=(await docs.libraryQuery({groupId:collection.id})).items;
 await apply(await batch('unassign',active,collection.id));await edit({type:'remove',id:collection.id,expected:rename.revision});
 assert.deepEqual((await (await organize()).labels(search)).items,[]);
 assert.equal((await docs.verify()).documents,3);
 const group=values.get('pdf-library:group:'+tag.id);group.pinned=null;values.set('pdf-library:group:'+tag.id,group);
 await assert.rejects(docs.verify(),{code:'CATALOGUE_DAMAGED'});
});
test('large libraries index bounded batches, resume past concurrent edits and search metadata without reading research prose',async()=>{
 const {reads,values,docs,titles,change}=setup();
 for(let i=0;i<320;i++){
  const id=randomUUID(),name=i===175||i===272?'Antenna drift':'Experiment '+String(i).padStart(3,'0');
  const header={version:1,id,name,language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Private section',content:'Private measurements',layout:null,start:null};
  const saved=await change(id,null,{type:'create',header,section});titles.push({id,header,revision:saved.revision});
 }
 assert.equal((await docs.libraryQuery({})).ready,false);
 reads.length=0;assert.deepEqual(await docs.prepareLibrary(),{ready:false});assert.equal(values.get('owner').pdfFormat,7);
 assert.ok(reads.filter(key=>key.startsWith('pdf:head:')).length<=32);
 const altered=titles[18],removed=titles[25];
 const rename=await change(altered.id,altered.revision,{type:'header',header:{...altered.header,name:'Excess temperature'}});
 const archived=await change(removed.id,removed.revision,{type:'remove'});
 let batches=1;while(!(await docs.prepareLibrary()).ready)batches++;
 assert.ok(batches>=9);
 reads.length=0;
 const matches=[];let result,cursor=null;
 do{result=await docs.libraryQuery({search:'antenna',cursor,limit:3});matches.push(...result.items);cursor=result.next;}while(cursor);
 assert.deepEqual(matches.map(row=>row.id).sort(),[titles[175].id,titles[272].id].sort());
 assert.ok(reads.every(key=>!key.startsWith('pdf:revision:')&&!key.includes(':value:')));assert.doesNotMatch(JSON.stringify(matches),/Private section|Private measurements/);
 assert.deepEqual((await docs.libraryQuery({sort:'recent',limit:1})).items.map(row=>[row.id,row.revision]),[[altered.id,rename.revision]]);
 assert.deepEqual((await docs.libraryQuery({archived:true})).items.map(row=>row.id),[removed.id]);
 const page=await docs.libraryQuery({limit:1});
 await change(removed.id,archived.revision,{type:'restore-document'});
 await assert.rejects(docs.libraryQuery({cursor:page.next,limit:1}),{code:'CONFLICT'});
 assert.deepEqual((await docs.libraryQuery({archived:true})).items,[]);
 const named=titles[175];await docs.pinDocument({id:named.id,expectedRevision:named.revision,pinned:true});
 await docs.pinDocument({id:named.id,expectedRevision:named.revision,pinned:true});
 assert.deepEqual((await docs.libraryQuery({sort:'pinned',search:'drift',match:'contains'})).items.map(row=>row.id),[named.id]);
 assert.deepEqual((await docs.libraryQuery({search:named.id})).items.map(row=>row.id),[named.id]);
 assert.equal((await docs.history(named.id)).items.length,1);
 const indexed=await docs.directory(),index=docs.index('library'),pages=new Set();
 for(const root of [indexed.library.names,indexed.library.pinned,indexed.library.recent])for await(const {ref} of index.nodes(root))pages.add('pdf:block:library:index:'+ref.hash);
 assert.deepEqual([...values.keys()].filter(key=>key.startsWith('pdf:block:library:index:')).sort(),[...pages].sort());
 const corrupted=values.get('pdf-library:item:'+named.id);corrupted.name='Unverified';values.set('pdf-library:item:'+named.id,corrupted);
 await assert.rejects(docs.libraryQuery({search:named.id}),{code:'CATALOGUE_DAMAGED'});
});

test('copying a projected research section preserves provenance and excludes existing or newly withdrawn writing',async()=>{
 const {docs,store,change}=setup(),id=randomUUID(),workspaceId=randomUUID(),recordId=randomUUID(),otherRecord=randomUUID();
 const revision='a'.repeat(64),state=new Map([[recordId,'Permitted research'],[otherRecord,'Withdrawn research']]);
 const files={sourceForRecord:async({recordId})=>state.has(recordId)?{id:recordId,visible:true,revision}:null,
  pdfSource:async key=>({title:state.get(key),revision,provenance:{workspaceId,recordId:key,recordRevision:revision},parts:{entry:state.get(key),sections:[],figures:[]}})};
 const selection=key=>pdfFileResearch(files,{operation:'selection',sourceId:workspaceId,snapshotId:revision,recordId:key,itemId:key,collection:'entry'});
 const fromResearch=research=>({id:randomUUID(),title:research.title,content:research.content,layout:null,start:null,research,figures:[]});
 const first=fromResearch(await selection(recordId)),second=fromResearch(await selection(otherRecord));
 const header={version:1,id,name:'Field observations',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
 const created=await change(id,null,{type:'create',header,section:first}),saved=await change(id,created.revision,{type:'append',section:second});
 state.delete(otherRecord);
 const destination=randomUUID(),copy={id:destination,commandId:randomUUID(),expectedRevision:null,operation:{type:'duplicate',id,expectedRevision:saved.revision,name:'Selected observations'}};
 await docs.change(copy,{publicationFiles:files});
 const entries=await docs.sections(destination);assert.equal(entries.total,1);
 const {section}=await docs.section(destination,entries.items[0].id);
 assert.equal(section.research.recordId,recordId);assert.equal(section.content,'Permitted research');assert.notEqual(section.id,first.id);
 state.delete(recordId);
 const visible=await projectPdfSection(store,files,destination,section);
 assert.equal(visible.withdrawn,true);assert.equal(visible.section.content,'');
});

test('duplicating remaps forward and note references into an independently editable single edition and replays the exact command',async()=>{
 const {docs,change}=setup(),id=randomUUID(),destination=randomUUID(),other=randomUUID(),note=randomUUID();
 const header={version:1,id,name:'Survey',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
 const second={id:randomUUID(),title:'Results',content:'Original results',layout:null,start:null};
 const link=(href,text)=>({type:'text',text,marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]});
 const target=documentId=>pdfCrossReference({documentId,sectionId:second.id,blockId:null,kind:'section'});
 const prose=content=>({type:'doc',content:[{type:'paragraph',content}]});
 const first={id:randomUUID(),title:'Introduction',content:prose([link(target(id),'Results'),link(pdfNoteCall(note),'†'),link(target(other),'External')]),layout:null,start:null,notes:[{id:note,anchor:'inline',kind:'footnote',content:prose([link(target(id),'See details')])}]};
 const created=await change(id,null,{type:'create',header,section:first}),saved=await change(id,created.revision,{type:'append',section:second});
 const command={id:destination,commandId:randomUUID(),expectedRevision:null,operation:{type:'duplicate',id,expectedRevision:saved.revision,name:'Survey copy'}};
 const copied=await docs.change(command),opened=await docs.open(destination),sections=await docs.sections(destination);
 assert.equal(opened.header.name,'Survey copy');assert.equal(opened.sequence,0);assert.equal(opened.count,2);
 const [copiedFirst,copiedSecond]=sections.items.map(row=>row.id);
 assert.notEqual(copiedFirst,first.id);assert.notEqual(copiedSecond,second.id);
 const newTarget=pdfCrossReference({documentId:destination,sectionId:copiedSecond,kind:'section',blockId:null});
 const {section}=await docs.section(destination,copiedFirst);
 assert.deepEqual(section.content.content[0].content.map(node=>node.marks[0].attrs.href),[newTarget,pdfNoteCall(note),target(other)]);
 assert.equal(section.notes[0].content.content[0].content[0].marks[0].attrs.href,newTarget);
 await change(destination,copied.revision,{type:'section',section:{...section,title:'Changed copy'}});
 assert.deepEqual(await docs.change(command),{revision:copied.revision,replayed:true});
 assert.deepEqual((await docs.history(destination)).items.map(row=>row.sequence),[1,0]);
 assert.equal((await docs.section(id,first.id)).section.title,'Introduction');
 assert.equal((await docs.open(id)).revision,saved.revision);
 await assert.rejects(docs.change({...command,operation:{...command.operation,name:'Other'}}),{code:'MODULE_REPLAY'});
 await assert.rejects(docs.change({...command,id:randomUUID(),operation:{...command.operation,expectedRevision:created.revision}}),{code:'CONFLICT'});
 assert.deepEqual(await docs.verify(),{documents:2,editions:4});
});
