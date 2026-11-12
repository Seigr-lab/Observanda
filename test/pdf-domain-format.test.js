import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {checkProjectDomainOwner} from '../src/project-domain-registry.js';
import {requiresPdfDomainFormat,requirePdfDomainFormat} from '../src/pdf-domain-format.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../src/web/pdf-structure-model.js';
import {pdfNoteCall} from '../src/web/pdf-notes-model.js';
import {pdfCrossReference} from '../src/web/pdf-cross-reference-model.js';
import {pdfPressDefaults} from '../src/web/pdf-press-model.js';

// This adapter includes the real authenticated domain identity and transaction
// boundary. Feature admission never relies on a production test-only bypass.
function fixture({domain='pdf',projectId=randomUUID()}={}){
 const namespaceId=randomUUID(),workspace={projectId,vault:{id:randomUUID()}},owner={version:projectId===null?2:1,projectId,namespaceId,domain,vaultId:workspace.vault.id},values=new Map([['owner',owner]]),writes=[];
 const run=async(operation,{write=false}={})=>{
  const before=structuredClone(values),store={domain,workspace,namespaceId,writable:write,db:{all:async sql=>{assert.equal(sql,'SELECT version FROM domain_format');return [{version:1}];}},object:async key=>structuredClone(values.get(key)??null),putObject:async(key,value)=>{assert.equal(write,true);writes.push(key);values.set(key,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...values.keys()].sort())if(key.startsWith(prefix))yield key;}};
  try{await checkProjectDomainOwner(store);return await operation(store);}catch(error){values.clear();for(const row of before)values.set(...row);throw error;}
 };
 return {owner,values,writes,run,change:command=>run(store=>new PdfDocumentStore(store).change(command),{write:true})};
}
function creation(){const id=randomUUID();return {id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name:'Compatibility report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:{id:randomUUID(),title:'Evidence',content:'Retained observations',layout:null,start:null}}};}

test('inline markers, equation citations and equation captions acquire authenticated format six before saving',async()=>{
 for(const edit of ['note','equation','captions']){
  const f=fixture(),create=creation(),initial=await f.change(create);
  let {header,section}=create.operation,operation;
  if(edit==='captions'){
   header={...header,structure:{...pdfStructureDefaults(),caption:pdfCaptionDefaults({equations:true})}};
   operation={type:'header',header};
  }else{
   const id=randomUUID(),href=edit==='note'?pdfNoteCall(id):pdfCrossReference({documentId:header.id,sectionId:section.id,kind:'equation',blockId:id});
   section={...section,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:edit==='note'?'†':'Formula',marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]}]}]}};
   if(edit==='note')section.notes=[{id,anchor:'inline',kind:'footnote',content:'Cited note.'}];
   operation={type:'section',section};
  }
  const command={id:header.id,commandId:randomUUID(),expectedRevision:initial.revision,operation};
  f.writes.length=0;const saved=await f.change(command);
  assert.equal(f.writes[0],'owner');assert.equal(f.values.get('owner').pdfFormat,6);
  assert.equal((await f.change(command)).revision,saved.revision);
  const open=store=>new PdfDocumentStore(store).verify();
  await f.run(open);
  f.values.set('owner',{...f.owner,pdfFormat:5});await assert.rejects(f.run(open),{code:'CATALOGUE_DAMAGED'});
  f.values.set('owner',{...f.owner,pdfFormat:9});await assert.rejects(f.run(open),{code:'ACCESS_UPGRADE'});
 }
});

test('a normal section save detects changed note placements, survives retry and requires explicit revision-bound review',async()=>{
 const f=fixture(),create=creation(),original=create.operation.section;
 original.content='Alpha\n\nBravo';
 original.notes=[{id:randomUUID(),kind:'footnote',content:'About the first passage',block:1}];
 const initial=await f.change(create);
 const next=(expectedRevision,operation)=>({id:create.id,commandId:randomUUID(),expectedRevision,operation});
 const read=async revision=>(await f.run(store=>new PdfDocumentStore(store).section(create.id,original.id,{revision}))).section;
 const swapped={...original,content:'Bravo\n\nAlpha'};
 const edit=next(initial.revision,{type:'section',section:swapped}),pending=await f.change(edit);
 assert.deepEqual(await read(initial.revision),original);
 assert.deepEqual(await read(pending.revision),{...swapped,placementReview:true});
 assert.deepEqual(await f.change(edit),{...pending,replayed:true});
 assert.equal(f.values.get('owner').pdfFormat,5);
 assert.equal((await f.change(next(pending.revision,{type:'section',section:swapped}))).revision,pending.revision);
 const confirm=next(pending.revision,{type:'confirm-placements',sectionId:original.id});
 await assert.rejects(f.change({...confirm,expectedRevision:initial.revision}),{code:'CONFLICT'});
 const accepted=await f.change(confirm);
 assert.deepEqual(await read(accepted.revision),swapped);
 assert.deepEqual(await f.change(confirm),{...accepted,replayed:true});
 const restored=await f.change(next(accepted.revision,{type:'restore',revision:pending.revision}));
 assert.equal((await read(restored.revision)).placementReview,true);
 assert.equal((await f.run(store=>new PdfDocumentStore(store).verify())).documents,1);
 f.values.set('owner',{...f.owner,pdfFormat:4});
 await assert.rejects(read(pending.revision),{code:'CATALOGUE_DAMAGED'});
});

test('ordinary PDF editions retain their exact legacy owner and both ownership scopes remain readable',async()=>{
 for(const projectId of [randomUUID(),null]){
  const f=fixture({projectId}),command=creation(),saved=await f.change(command);
  assert.deepEqual(f.values.get('owner'),f.owner);assert.equal(f.writes.includes('owner'),false);
  await f.change({id:command.id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'section',section:{...command.operation.section,notes:[{id:randomUUID(),kind:'footnote',block:0,content:'Existing section note'}]}}});
  assert.deepEqual(f.values.get('owner'),f.owner);assert.equal((await f.run(store=>new PdfDocumentStore(store).verify())).documents,1);
 }
 assert.equal(requiresPdfDomainFormat({header:{outputProfile:'a-future-explicit-profile'}}),true);
});

test('new PDF fields acquire the owner marker before immutable writes, retain it for history and roll back atomically',async()=>{
 for(const feature of ['press','outputProfile','page-footnote','selected-table']){
  const f=fixture(),command=creation(),saved=await f.change(command),operation=feature==='selected-table'?{type:'section',section:{...command.operation.section,research:(()=>{const blockId=randomUUID();return {version:1,workspaceId:randomUUID(),snapshotId:'a'.repeat(64),recordId:randomUUID(),recordRevision:'b'.repeat(64),collection:'sections',itemId:randomUUID(),blockId,title:'Selected table',content:{type:'doc',content:[{type:'book_table',attrs:{version:1,id:blockId,title:'Selected table',headers:['Value'],rows:[['9007199254740993']]}}]},figures:[]};})()}}:feature==='page-footnote'?{type:'section',section:{...command.operation.section,notes:[{id:randomUUID(),kind:feature,block:0,content:'Page note'}]}}:{type:'header',header:{...command.operation.header,...(feature==='press'?{press:pdfPressDefaults()}:{outputProfile:'pdfa-2u'})}},edit={id:command.id,commandId:randomUUID(),expectedRevision:saved.revision,operation};
  const before=structuredClone(f.values);await assert.rejects(f.run(async store=>{await new PdfDocumentStore(store).change(edit);throw new Error('rollback feature');},{write:true}),/rollback feature/);assert.deepEqual(f.values,before);
  f.writes.length=0;const changed=await f.change(edit);assert.equal(f.writes[0],'owner');assert.deepEqual(f.values.get('owner'),{...f.owner,pdfFormat:2});const writes=f.writes.length;
  assert.deepEqual(await f.change(edit),{revision:changed.revision,replayed:true});assert.equal(f.writes.length,writes);
  const revert=['page-footnote','selected-table'].includes(feature)?{type:'section',section:command.operation.section}:{type:'header',header:command.operation.header};await f.change({id:command.id,commandId:randomUUID(),expectedRevision:changed.revision,operation:revert});assert.equal(f.values.get('owner').pdfFormat,2);
  await f.run(async store=>{const documents=new PdfDocumentStore(store);await documents.open(command.id,{revision:changed.revision});await documents.verify();});
  f.values.set('owner',f.owner);await assert.rejects(f.run(store=>new PdfDocumentStore(store).verify()),{code:'CATALOGUE_DAMAGED'});
 }
});

test('domain admission rejects malformed, future and non-PDF markers before a callback can mutate',async()=>{
 for(const [domain,pdfFormat,code] of [['pdf',null,'CATALOGUE_DAMAGED'],['pdf',1,'CATALOGUE_DAMAGED'],['pdf','2','CATALOGUE_DAMAGED'],['pdf',2.5,'CATALOGUE_DAMAGED'],['pdf',99,'ACCESS_UPGRADE'],['calculator',2,'CATALOGUE_DAMAGED']]){
  const f=fixture({domain});f.values.set('owner',{...f.owner,pdfFormat});let called=false;await assert.rejects(f.run(async store=>{called=true;await store.putObject('must-not-exist',{});},{write:true}),{code});assert.equal(called,false);assert.equal(f.values.has('must-not-exist'),false);
 }
 const f=fixture();await assert.rejects(f.run(requirePdfDomainFormat),{code:'INVALID'});assert.deepEqual(f.values.get('owner'),f.owner);
 // The previous reader's exact owner-key contract rejects the new marker.
 assert.notEqual(Object.keys({...f.owner,pdfFormat:2}).sort().join(),['domain','namespaceId','projectId','vaultId','version'].sort().join());
});


test('format three is admitted, retained across older features and acquired for authored bleed',async()=>{
 const f=fixture();await f.run(store=>requirePdfDomainFormat(store,3),{write:true});assert.equal(f.values.get('owner').pdfFormat,3);
 await f.run(store=>requirePdfDomainFormat(store,2),{write:true});assert.equal(f.values.get('owner').pdfFormat,3);await f.run(async()=>{});
 const fresh=fixture(),command=creation();command.operation.header.press={version:2,bleedMm:3,cropMarks:true,artwork:{background:'#ffffff',image:null,pages:'all'}};
 await fresh.change(command);assert.equal(fresh.values.get('owner').pdfFormat,3);fresh.values.set('owner',{...fresh.owner,pdfFormat:2});await assert.rejects(fresh.run(store=>new PdfDocumentStore(store).open(command.id)),{code:'CATALOGUE_DAMAGED'});
});

test('printed QR settings acquire format four before writes and retain history after disabling',async()=>{
 const f=fixture(),command=creation(),initial=await f.change(command);const header={...command.operation.header,structure:{...pdfStructureDefaults(),printQrCodes:true}},change={id:command.id,commandId:randomUUID(),expectedRevision:initial.revision,operation:{type:'header',header}};
 f.writes.length=0;const saved=await f.change(change);assert.equal(f.writes[0],'owner');assert.equal(f.values.get('owner').pdfFormat,4);
 await f.change({id:command.id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header:{...header,structure:{...header.structure,printQrCodes:false}}}});assert.equal(f.values.get('owner').pdfFormat,4);assert.equal((await f.run(store=>new PdfDocumentStore(store).open(command.id,{revision:saved.revision}))).header.structure.printQrCodes,true);await f.run(store=>new PdfDocumentStore(store).verify());
 f.values.set('owner',{...f.owner,pdfFormat:3});await assert.rejects(f.run(store=>new PdfDocumentStore(store).verify()),{code:'CATALOGUE_DAMAGED'});
});
