import {liveValid as valid} from './live-protocol.js';
import {exact} from '../modules/validation.js';
import {ResearchMaterials,materialRef} from '../research-materials.js';

// Traversal and bounded data pages are shared by facts and the record's material
// library. Each caller authorizes its root before this owner follows any input.
export class LiveMaterialReading{
 constructor(workspace,readRecord){this.workspace=workspace;this.readRecord=readRecord;this.materials=new ResearchMaterials(workspace);}
 async resolve(store,access,ref){
  valid(materialRef(ref));const workspaceId=(await store.snapshot()).metadata.id;
  valid(ref.workspaceId===undefined||ref.workspaceId===workspaceId,'COLLABORATION_DENIED');
  if(ref.kind==='record')await this.readRecord(store,access,ref.id);
  const document=await this.materials.read(ref);
  if(ref.kind==='record')valid(access.notebookIds.includes(document.notebookId),'COLLABORATION_DENIED');
  else await this.readRecord(store,access,document.recordId);
  return document;
 }
 async read(store,access,source,ref,trail=[]){
  valid(materialRef(ref));
  valid(Array.isArray(trail)&&trail.length<=16&&trail.every(step=>exact(step,['slot','index'])&&['inputs','outputs'].includes(step.slot)&&Number.isSafeInteger(step.index)&&step.index>=0));
  let document=await this.resolve(store,access,ref);
  for(const step of trail){
   valid(ref.kind!=='record');const page=await this.materials.referencePage(ref,{slot:step.slot,offset:step.index,limit:1});valid(page.items.length===1,'COLLABORATION_DENIED');
   const item=page.items[0];ref={kind:item.kind,id:item.id,revision:item.revision,...(item.workspaceId?{workspaceId:item.workspaceId}:{})};document=await this.resolve(store,access,ref);
  }
  const reference={kind:ref.kind,id:ref.id,revision:ref.revision};
  return ref.kind==='record'?{record:document,revision:ref.revision,reference}:{document,revision:ref.revision,reference};
 }
 async page(store,access,source,data){
  const retained=await this.read(store,access,source,data.ref,data.trail);valid(retained.document);
  if(data.slot==='rows'){
   const {page=0,rowOffset=0,columnOffset=0}=data;valid(Number.isSafeInteger(rowOffset)&&rowOffset>=0);
   const result=await this.materials.datasetPage(retained.reference,page,{columnOffset,columnLimit:16});valid(rowOffset<result.rows.length||rowOffset===0&&result.rows.length===0);
   // Bound peer delivery independently of native page sizing, without
   // coercing cells or dropping their retained source locators.
   const rows=[];let bytes=Buffer.byteLength(JSON.stringify(result.columns));
   for(const row of result.rows.slice(rowOffset,rowOffset+50)){const size=Buffer.byteLength(JSON.stringify(row));if(rows.length&&bytes+size>768*1024)break;valid(bytes+size<1536*1024,'LIMIT');rows.push(row);bytes+=size;}
   const next=rowOffset+rows.length<result.rows.length?{page,rowOffset:rowOffset+rows.length}:page+1<result.pages?{page:page+1,rowOffset:0}:null;
   return {...result,rows,rowOffset,next};
  }
  valid(['inputs','outputs'].includes(data.slot));const result=await this.materials.referencePage(retained.reference,{slot:data.slot,offset:data.offset??0,limit:20}),items=[];
  for(const item of result.items){try{await this.resolve(store,access,item);items.push(item);}catch(error){if(error.code!=='COLLABORATION_DENIED')throw error;items.push({withheld:true});}}
  return {...result,items};
 }
}
