import {validateDetachedRecords} from '../model.js';
import {exact,uuid} from '../modules/validation.js';
import {revisionId} from '../web/revision-model.js';
import {validMaterialReference} from '../web/material-reference.js';
import {STATUSES} from '../web/record-types.js';
import {AppError} from '../errors.js';

const fail=()=>{throw new AppError('COLLABORATION_INVALID');};
// A verified peer identity authenticates the sender, not the record schema.
// Apply the detached-record contract to every response carrying a record,
// including records reached through retained material and relationship trails.
export function validateLiveRecordResponse(operation,value,data,scope){
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 try{
  if(operation==='create'){
   const record=value.record;
   if(!exact(value,['hash','record','removed'])||typeof value.removed!=='boolean'||!revisionId(value.hash)||!exact(record,['id','notebookId','title','status','revision'])||!uuid(record.id)||record.notebookId!==data.notebookId||typeof record.title!=='string'||!STATUSES.includes(record.status)||!revisionId(record.revision))fail();
   return value;
  }else if(operation==='read'){
   if(!exact(value,['record','revision','role','workspaceId',...(Object.hasOwn(value,'attemptRevision')?['attemptRevision']:[])])||value.workspaceId!==scope.workspaceId||!['reader','editor'].includes(value.role)||value.record?.id!==data.recordId||Object.hasOwn(value,'attemptRevision')&&(!data.pagedAttempt||!revisionId(value.attemptRevision)))fail();
  }else if(operation==='link-read'){
   if(!exact(value,['record','revision','currentRevision'])||!revisionId(value.currentRevision))fail();
  }else if(['attempt-read','evidence-read'].includes(operation)){
   const field=Object.hasOwn(value,'record')?'record':'document';
   if(!exact(value,[field,'revision','reference'])||!validMaterialReference(value.reference)||!exact(value.reference,['kind','id','revision'])||value.reference.revision!==value.revision||(field==='record')!==(value.reference.kind==='record')||value[field]?.id!==value.reference.id)fail();
  }else if(Object.hasOwn(value,'record'))fail();
  if(Object.hasOwn(value,'record')){
   if(!uuid(value.record?.id)||!revisionId(value.revision))fail();
   validateDetachedRecords([value.record]);
  }
 }catch{fail();}
 return value;
}

// Never republish a peer's active MIME type or Content-Disposition at the
// privileged application origin. Media is limited to our canonical encodings;
// original artifacts and figure exports are always inert downloads.
export function liveFileHeaders(headers,{media=false,format}={}){
 const type=headers['content-type'];
 if(media&&!['image/png','audio/wav','video/mp4'].includes(type))fail();
 const result={'Content-Type':media?type:'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin'};
 if(!media)result['Content-Disposition']='attachment; filename="shared-file'+(['csv','svg','png','pdf'].includes(format)?'.'+format:'')+'"';
 const length=headers['content-length'];
 if(length!==undefined){if(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length)))fail();result['Content-Length']=length;}
 return result;
}
