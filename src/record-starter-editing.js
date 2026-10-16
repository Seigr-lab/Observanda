import {starterRequestMatches} from './project-starter-receipts.js';
import {RecordStarters,STARTER_ROOT} from './record-starters.js';
import {RecordDocument} from './record-document.js';
import {retainStarterDocument} from './record-starter-documents.js';
import {starterKeys,validStarter} from './web/record-starter-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {packageDigest} from './record-starter-package.js';
import {requireStarterDocuments} from './catalogue-format.js';
import {AppError} from './errors.js';
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const fail=()=>{throw new AppError('STARTER_INVALID');};
const empty={name:'Template',title:'New record',type:'protocol',body:'',tags:[],sections:[]};
const target=['workspaceId','id','release'];
export class RecordStarterEditing extends RecordStarters{
 async source(command,keys,consume){
  if(!starterKeys(command,[...target,...keys])||!researchId(command.workspaceId)||!researchId(command.id)||command.release!==null&&!revisionId(command.release))fail();
  return this.workspace.catalogue(async()=>{
   await this.context(command.workspaceId);const header=await this.header(command.id);let document,release=null;
   if(command.release){const source=await this.releaseDocument({workspaceId:command.workspaceId,id:command.id,release:command.release});release={revision:command.release};for(const field of ['number','note','createdAt'])release[field]=(await source.field([field])).value;document=new RecordDocument(source.blocks,await source.reference(['blueprint']));}
   else document=await this.draftDocument(header);
   return consume({header,release,document});
  });
 }
 async view(command){
  if(!natural(command?.offset))fail();
  return this.source(command,['offset'],async({header,release,document})=>{
   return this.describe(document,{header,release},command.offset);
  });
 }
 async describe(document,metadata,requested){
   const blueprint={};for(const field of ['name','title','type'])blueprint[field]=(await document.field([field])).value;
   const total=await document.tree.arrayLength(document.root,['sections']),offset=Math.min(requested,Math.max(0,total-1)),sections=[];
   for(let position=offset;position<Math.min(total,offset+20);position++)sections.push({position,title:(await document.field(['sections',String(position),'title'])).value});
   return {...metadata,blueprint,sections:{total,offset,values:sections},tags:await document.tree.arrayLength(document.root,['tags'])};
 }
 async field(command){
  if(!['body','section','tags'].includes(command?.field)||!natural(command.position))fail();
  return this.source(command,['field','position'],async({header,release,document})=>{
   return {header,release,...await this.selectedField(document,command)};
  });
 }
 async selectedField(document,command){
   if(!['body','section','tags'].includes(command?.field)||!natural(command.position))fail();
   let value,total=null;
   if(command.field==='tags'){const page=await document.tree.page(document.root,['tags'],{offset:command.position,limit:20});value=page.values;total=page.total;}
   else{const selected=await document.field(command.field==='body'?['body']:['sections',String(command.position)]);if(!selected.found)throw new AppError('NOT_FOUND');value=selected.value;}
   return {field:command.field,position:command.position,value,total};
 }
 async change(command){
  if(!starterKeys(command,['workspaceId','id','expectedRevision','commandId','operation','position','value'])||!researchId(command.workspaceId)||!researchId(command.id)||!researchId(command.commandId)||!revisionId(command.expectedRevision)||!natural(command.position)||!['details','body','section','insert','remove','move','tag-add','tag-remove'].includes(command.operation))fail();
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   await this.context(command.workspaceId);const receiptFile=STARTER_ROOT+'/commands/'+command.id+'/'+command.commandId+'.json',request=packageDigest(command),receipt=await this.object(receiptFile);
   if(receipt){if(!await starterRequestMatches(this.workspace,command,receipt,'request',receiptFile))throw new AppError('STARTER_CHANGED');return receipt.result;}
   const header=await this.header(command.id);if(header.revision!==command.expectedRevision)throw new AppError('STARTER_CHANGED');if(header.status!=='active')throw new AppError('STARTER_ARCHIVED');
   await requireStarterDocuments(store.db);let document=await this.draftDocument(header,{mutable:true});const {operation,position,value}=command;
   const valid=changes=>validStarter({...empty,...changes},{portable:false});
   if(operation==='details'){
    if(!starterKeys(value,['name','title','type'])||!valid(value))fail();for(const [key,next] of Object.entries(value))document=await document.replace([key],next);
   }else if(operation==='body'){if(!valid({body:value}))fail();document=await document.replace(['body'],value);}
   else if(operation==='tag-add'){
    if(!valid({tags:[value]}))fail();for await(const item of document.items(['tags']))if(await document.tree.read(item.value)===value)fail();document=await document.splice(['tags'],await document.tree.arrayLength(document.root,['tags']),0,[value]);
   }else if(operation==='tag-remove'){
    if(value!==null||position>=await document.tree.arrayLength(document.root,['tags']))fail();document=await document.splice(['tags'],position,1,[]);
   }else{
    const total=await document.tree.arrayLength(document.root,['sections']);
    if(operation==='insert'){if(position>total||!valid({sections:[value]}))fail();document=await document.splice(['sections'],position,0,[value]);}
    else{
     if(position>=total)fail();
     if(operation==='section'){if(!valid({sections:[value]}))fail();document=await document.replace(['sections',String(position)],value);}
     if(operation==='remove'){if(value!==null)fail();document=await document.splice(['sections'],position,1,[]);}
     if(operation==='move'){if(!natural(value)||value>=total)fail();const selected=(await document.field(['sections',String(position)])).value;document=await document.splice(['sections'],position,1,[]);document=await document.splice(['sections'],value,0,[selected]);}
    }
   }
   const pointer=await retainStarterDocument(document),{revision,...next}=header;next.draftHash=pointer.fingerprint;next.name=(await document.field(['name'])).value;
   await this.workspace.writeMetadata(STARTER_ROOT+'/drafts/'+command.id+'.json',JSON.stringify(pointer));await this.workspace.writeMetadata(STARTER_ROOT+'/headers/'+command.id+'.json',JSON.stringify(next));
   const result={header:{...next,revision:packageDigest(next)}};await this.workspace.writeMetadata(receiptFile,JSON.stringify({request,result}));return result;
  }));
 }
}
