import {t} from './i18n/index.js';
// A new record is a server draft until its first Save, written on the same record page as a
// saved record. The page's editing parts send the commands they send for a saved record;
// while the draft is open, each command for its record is turned here into the matching
// draft edit. Every edit is written against the value it read, so a stale page is refused
// (RECORD_CHANGED) exactly as a saved record's page is.
const review=operation=>'/api/research/drafts/review/'+operation;
const changed=()=>Object.assign(Error('The record changed.'),{code:'RECORD_CHANGED'});
const emptyBody={type:'doc',content:[{type:'paragraph',content:[]}]};
// While the record is being saved, or its save is not yet confirmed, it is not changed.
const saving=()=>Object.assign(Error(t('configurationEditor','recordSavingWait')),{code:'RECORD_SAVING'});

export function recordDraftTransport({api,draft,written}){
 const target=current=>({id:current.id,workspaceId:current.workspaceId,expectedRevision:current.revision});
 const call=(current,operation,data,options)=>api(review(operation),{...target(current),...data},{...options,adopt:false});
 const base=(current,selected)=>({id:current.id,edit:selected.editRevision});
 async function read(current,field,options){return call(current,'editRead',{field},options);}
 // Read the value, check it is the one the page edited, and write the change against it.
 async function write(current,field,value,{expected,options}={}){
  if(current.saving)throw saving();
  const selected=await read(current,field,options);
  if(expected!==undefined&&selected.revision!==expected)throw changed();
  const result=await call(current,'editWrite',{field,value,valueRevision:selected.revision,editRevision:selected.editRevision,operationId:crypto.randomUUID()},options);
  written();return result;
 }
 const reply=(current,selected,key)=>({workspaceId:selected.workspaceId,recordId:selected.recordId,...key,revision:selected.revision,recordTitle:selected.recordTitle,value:selected.value,definition:selected.definition,editRevision:selected.editRevision,recordDraft:base(current,selected)});
 const writingField=sectionId=>sectionId===null?'body':'section:'+sectionId;
 async function saved(current,field,key,command,options){
  await write(current,field,command.value,{expected:command.expectedRevision,options});
  const selected=await read(current,field,options);
  return {saved:true,...reply(current,selected,key)};
 }
 const routes={
  '/api/workspace/read/record-content':async(current,data,options)=>{
   const result=await call(current,'reading',{offset:data.offset??0,...(data.windows?{windows:data.windows}:{})},options);
   // A draft is not read from a workspace snapshot; the page's snapshot is answered unchanged.
   return {...result,etag:data.snapshotId};
  },
  '/api/research/records/values/read':async(current,data,options)=>reply(current,await read(current,data.field,options),{field:data.field}),
  '/api/research/records/values/save':(current,data,options)=>saved(current,data.field,{field:data.field},data,options),
  '/api/research/records/writing/read':async(current,data,options)=>reply(current,await read(current,writingField(data.sectionId),options),{sectionId:data.sectionId}),
  '/api/research/records/writing/save':(current,data,options)=>saved(current,writingField(data.sectionId),{sectionId:data.sectionId},data,options),
  '/api/research/records/values/choices':async(current,data,options)=>call(current,'editChoices',{field:data.field,editRevision:data.editRevision??(await read(current,data.field,options)).editRevision,schemaRevision:data.schemaRevision,offset:data.offset,query:data.query},options),
  '/api/research/records/values/figures':(current,data,options)=>call(current,'editFigures',{offset:data.offset,...(data.editRevision!==undefined?{editRevision:data.editRevision}:{}),...(data.figureId?{figureId:data.figureId}:{})},options),
  '/api/research/records/values/attempt-context':(current,data,options)=>call(current,'editAttempts',{field:data.field,prior:data.prior,preparationId:data.preparationId,offset:data.offset,...(data.criterionId!==undefined?{criterionId:data.criterionId}:{}),...(data.criterionOffset!==undefined?{criterionOffset:data.criterionOffset}:{})},options),
  '/api/research/records/writing/outline':async(current,data,options)=>{
   // The draft's sections, 16 at a time, from its section fields (the summary is field 0).
   const structure=await read(current,'sections',options),structureRevision=structure.editRevision??current.revision;
   if(data.expectedStructureRevision!==null&&data.expectedStructureRevision!==structureRevision)throw changed();
   const ids=structure.value.ids,total=ids.length,position=data.anchor===null?data.offset:ids.indexOf(data.anchor);
   if(position<0)throw Object.assign(Error('The section is missing.'),{code:'MISSING'});
   const start=data.anchor===null?data.offset:Math.floor(position/16)*16,sections=[];
   for(let at=start+1;at<Math.min(start+16,total)+1;at+=8){
    const page=await call(current,'editFields',{group:'writing',offset:at},options);
    for(const item of page.items)if(sections.length<16&&item.field.startsWith('section:'))sections.push({id:item.field.slice(8),title:item.label,position:start+sections.length});
   }
   return {workspaceId:data.workspaceId,recordId:data.recordId,structureRevision,total,offset:start,sections,previous:start?Math.max(0,start-16):null,next:start+16<total?start+16:null};
  },
  '/api/research/records/sections':async(current,data,options)=>{
   const value=data.action==='insert'?{action:'insert',sectionId:data.sectionId,beforeId:data.beforeId,value:{title:data.value.title,body:data.value.body||emptyBody}}:data.action==='move'?{action:'move',sectionId:data.sectionId,position:data.position}:{action:'remove',sectionId:data.sectionId};
   await write(current,'sections',value,{options});return {saved:true};
  },
  '/api/research/records/tags':async(current,data,options)=>{
   // A tag is written at its position; the position after the last tag adds one.
   const position=data.action==='add'?(await call(current,'editFields',{group:'tags',offset:0},options)).total:data.position;
   await write(current,'tag:'+position,{value:data.action==='remove'?null:data.tag},{options});return {saved:true,position:data.action==='remove'?Math.max(0,position-1):position};
  },
  '/api/research/records/media':async(current,data,options)=>{
   const value=data.action==='attach'?{action:'attach',mediaId:data.mediaId,kind:options?.mediaKind}:data.action==='move'?{action:'move',mediaId:data.mediaId,position:data.position}:{action:'remove',mediaId:data.mediaId};
   await write(current,'attachments',value,{options});
   const ids=(await read(current,'attachments',options)).value.ids;
   return {saved:true,position:Math.max(0,ids.indexOf(data.mediaId))};
  },
  '/api/research/records/figures':async(current,data,options)=>{
   const copyId=crypto.randomUUID();
   await write(current,'figures',data.action==='duplicate'?{action:'duplicate',figureId:data.figureId,copyId}:{action:'remove',figureId:data.figureId},{options});
   const ids=(await read(current,'figures',options)).value.ids;
   return {saved:true,position:Math.max(0,ids.indexOf(copyId))};
  },
 };
 // The command is the open draft's when it names the draft's record.
 return function translate(route,data,options){
  const current=draft();if(!current||!routes[route]||data?.recordId!==current.recordId||data?.workspaceId!==current.workspaceId)return null;
  return routes[route](current,data,options);
 };
}
