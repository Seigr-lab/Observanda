import {bomSourceAccess} from './bom-connections-client.js';
import {addressedBOM} from './bom-model.js';
import {decimal} from './quantities.js';
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const aborted=()=>new DOMException('BOM operation view changed','AbortError');
const invalid=()=>{throw Error('BOM_OPERATION_RESPONSE');};
const accessCodes=['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'];
export function validBOMOperation(value){return value&&id(value.id)&&id(value.bomId)&&['reserve','finish','cancel'].includes(value.action)&&['preparing','committing','aborting','complete','aborted'].includes(value.phase)&&[null,'commit','abort'].includes(value.decision)&&typeof value.terminal==='boolean'&&value.terminal===['complete','aborted'].includes(value.phase)&&Number.isSafeInteger(value.participants)&&value.participants>0&&Number.isSafeInteger(value.remaining)&&value.remaining>=0&&value.remaining<=value.participants&&typeof value.canResume==='boolean'&&typeof value.canAbort==='boolean'&&(!value.terminal||!value.canResume&&!value.canAbort)&&(!value.canAbort||value.decision===null)&&(!value.error||typeof value.error.code==='string'&&(!value.error.owner||id(value.error.owner.workspaceId)))&&(value.usage===undefined||Array.isArray(value.usage)&&value.usage.every(item=>id(item.lineId)&&decimal(item.used)&&decimal(item.scrapped)));}
export function bomOperationClient({state,api,access:requestAccess=run=>run(),current,changed=()=>{}}){
 const access=bomSourceAccess({state,api,access:requestAccess});
 let generation=0;const reads=new Set(),operations=new Map();
 const active=()=>state.page==='module'&&state.moduleId==='resources'&&!state.access?.locked&&!state.storageUnavailable;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,state.modulePath]);
 function capture(){const draft=current();if(!active()||draft?.type!=='bom')throw aborted();const stamp=identity(),epoch=generation,revision=draft.expectedRevision;return {draft,workspaceId:state.book.id,valid:()=>active()&&identity()===stamp&&epoch===generation&&current()===draft&&draft.expectedRevision===revision};}
 function accept(result,{workspaceId,bomId,operationId}={}){
  if(result?.workspaceId!==workspaceId||typeof result.operationPending!=='boolean'||!validBOMOperation(result.operation)||result.operation.bomId!==bomId||operationId&&result.operation.id!==operationId||result.operationPending===result.operation.terminal)invalid();
  operations.set(bomId,result.operation);changed();return result;
 }
 async function status({signal}={}){
  const captured=capture(),controller=new AbortController();reads.add(controller);const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  try{const result=await api('/api/modules/bom/operation/status',{workspaceId:captured.workspaceId,bomId:captured.draft.id},{adopt:false,signal:combined});if(!captured.valid()||combined.aborted)throw aborted();if(result?.workspaceId!==captured.workspaceId||result.operation!==null&&(!validBOMOperation(result.operation)||result.operation.bomId!==captured.draft.id))invalid();if(result.operation)operations.set(captured.draft.id,result.operation);else operations.delete(captured.draft.id);return result;}
  catch(error){if(!captured.valid()||combined.aborted)throw aborted();throw error;}finally{reads.delete(controller);}
 }
 async function commandRequest(run,{action,payload,context,commandId}){
  const internal=['bom.resume','bom.abort'].includes(action),draft=context.current;
  if(!internal&&(!['bom.reserve','bom.finish','bom.cancel'].includes(action)||!addressedBOM(draft.data)&&!draft.data.externalStock))return run();
  const captured=capture(),original=structuredClone(payload),expected=internal?operations.get(draft.id)?.id:commandId;
  if((internal?payload.id!==expected:payload.id!==draft.id||payload.expectedRevision!==draft.expectedRevision)||JSON.stringify(draft.data)!==JSON.stringify(draft.base))throw aborted();
  const data=JSON.stringify(draft.data),valid=()=>captured.valid()&&data===JSON.stringify(draft.data)&&JSON.stringify(payload)===JSON.stringify(original);
  let retained=null;
  const guarded=async()=>{
   if(!valid())throw aborted();
   try{
    const result=await (internal?api('/api/modules/bom/operation/'+(action==='bom.resume'?'resume':'abort'),{workspaceId:captured.workspaceId,id:payload.id},{adopt:false}):run());
    if(Object.hasOwn(result,'operationPending')){
     accept(result,{workspaceId:captured.workspaceId,bomId:draft.id,operationId:expected});retained=result;
     if(valid()&&result.operationPending&&accessCodes.includes(result.operation.error?.code)&&result.operation.error.owner?.projectId)throw {...result.operation.error,...result.operation.error.owner};
    }
    return result;
   }catch(error){if(!valid())throw aborted();throw error;}
  };
  try{return await access(guarded);}catch(error){if(error.name==='AbortError'&&valid()&&retained)return retained;throw error;}
 }
 function pendingCommand(result,{action,payload,commandId,context}){
  const internal=['bom.resume','bom.abort'].includes(action),bomId=internal?result.operation?.bomId:payload.id;
  accept(result,{workspaceId:context.snapshot.workspaceId,bomId,operationId:internal?payload.id:commandId});
 }
 function cancel(){generation++;for(const read of reads)read.abort();reads.clear();}
 return {status,commandRequest,pendingCommand,cancel,get:bomId=>operations.get(bomId)??null,clear:bomId=>operations.delete(bomId)};
}
