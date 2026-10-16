import {researchId} from '../research-reference.js';
import {revisionId} from '../revision-model.js';

export const referenceKey=reference=>JSON.stringify([reference.workspaceId,reference.type,reference.id]);
export const validModuleReference=value=>value&&researchId(value.workspaceId)&&researchId(value.id)&&typeof value.type==='string'&&/^[a-z][a-z-]{0,39}$/.test(value.type);
const nullableId=value=>value===null||researchId(value);
export const validReferenceOwner=value=>value&&researchId(value.workspaceId)&&nullableId(value.projectId)&&nullableId(value.labBookId)&&(!value.labBookId||!!value.projectId);
const token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=8192;
const summary=value=>value&&validModuleReference(value.reference)&&typeof value.title==='string'&&typeof value.openType==='string'&&/^[a-z][a-z-]{0,39}$/.test(value.openType)&&researchId(value.openId);
const invalid=()=>{throw new Error('MODULE_REFERENCE_RESPONSE');};
const aborted=()=>new DOMException('Reference selection changed','AbortError');

// Requests belong to the source editor. Selected destinations supply summaries
// and never replace its owner, research document or recoverable draft.
export function moduleReferenceClient({state,api,access=operation=>operation(),identity=()=>state.modulePath,active=()=>state.page==='module'}){
 let stamp=null,epoch=0;const requests=new Set();
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,identity()]);
 const available=()=>active()&&!state.access?.locked&&!state.storageUnavailable;
 function cancel(){epoch++;for(const controller of requests)controller.abort();requests.clear();}
 function sync(){const value=context();if(stamp!==value||!available()){cancel();stamp=value;}return stamp;}
 async function request(endpoint,body,{signal,unlock=false}={}){
  sync();if(!available())throw aborted();
  const key=stamp,version=epoch,workspaceId=state.book.id,controller=new AbortController();requests.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const valid=()=>!combined.aborted&&version===epoch&&key===context()&&available();
  const run=async()=>{if(!valid())throw aborted();try{const result=await api('/api/modules/references/'+endpoint,{...body,workspaceId},{adopt:false,signal:combined});if(!valid())throw aborted();return result;}catch(error){if(!valid())throw aborted();throw error;}};
  try{const result=await (unlock?access(run):run());if(!valid())throw aborted();if(result?.workspaceId!==workspaceId)invalid();return result;}
  finally{requests.delete(controller);}
 }
 async function owners({projectId=null,search='',offset=0,limit=25,revision=null}={},options={}){
  const result=await request('owners',{projectId,search,offset,limit,revision},options);
  if(result.projectId!==projectId||!revisionId(result.revision)||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||result.items.length>limit||result.items.length!==Math.min(limit,Math.max(0,result.total-offset))||result.items.some(item=>!validReferenceOwner(item)||!['workspace','project','lab-book'].includes(item.kind)||typeof item.label!=='string'||!Array.isArray(item.ancestors)||item.ancestors.some(name=>typeof name!=='string')||projectId!==null&&item.projectId!==projectId)||new Set(result.items.map(item=>item.workspaceId)).size!==result.items.length)invalid();
  return result;
 }
 async function query({sourceId,types,query='',cursor=null,limit=25},options={}){
  const result=await request('query',{sourceId,types,query,cursor,limit},options);
  if(result.sourceId!==sourceId||!validReferenceOwner(result.owner)||result.owner.workspaceId!==sourceId||!revisionId(result.revision)||!Array.isArray(result.items)||result.items.length>limit||result.items.some(item=>!summary(item)||item.reference.workspaceId!==sourceId||!types.includes(item.reference.type))||new Set(result.items.map(item=>referenceKey(item.reference))).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||![result.cursor,result.nextCursor,result.previousCursor].every(token))invalid();
  return result;
 }
 async function labels(references,options={}){
  if(!Array.isArray(references)||references.length>25||references.some(item=>!validModuleReference(item))||new Set(references.map(referenceKey)).size!==references.length)throw new TypeError('Invalid reference labels');
  const result=await request('labels',{references},options),keys=new Set(references.map(referenceKey));
  if(!Array.isArray(result.items)||result.items.length!==references.length||new Set(result.items.map(item=>validModuleReference(item?.reference)?referenceKey(item.reference):null)).size!==references.length||result.items.some(item=>!validModuleReference(item?.reference)||!keys.has(referenceKey(item.reference))||!['available','unavailable'].includes(item.status)||item.status==='available'&&(!summary(item)||!validReferenceOwner(item.owner))||item.status==='unavailable'&&(typeof item.code!=='string'||Object.hasOwn(item,'title')||item.owner!==undefined&&!validReferenceOwner(item.owner))))invalid();
  return result;
 }
 async function resolve(target,options={}){
  if(!validModuleReference(target))throw new TypeError('Invalid reference');
  const result=await request('resolve',{target},options);
  if(!summary(result)||referenceKey(result.reference)!==referenceKey(target)||!validReferenceOwner(result.owner)||result.type!==target.type||result.id!==target.id)invalid();
  return result;
 }
 async function incoming({target,types=null,query='',cursor=null,limit=25},options={}){
  if(!validModuleReference(target))throw new TypeError('Invalid incoming reference');
  const result=await request('incoming',{target,types,query,cursor,limit},options);
  if(!validModuleReference(result.target)||referenceKey(result.target)!==referenceKey(target)||!Array.isArray(result.items)||result.items.length>limit||result.items.some(item=>!summary(item)||!validReferenceOwner(item.owner)||item.owner.workspaceId!==item.reference.workspaceId||types&&!types.includes(item.reference.type))||new Set(result.items.map(item=>referenceKey(item.reference))).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||![result.cursor,result.nextCursor,result.previousCursor].every(token)||typeof result.partial!=='boolean'||!Array.isArray(result.unavailable)||result.unavailable.length>25||!Number.isSafeInteger(result.unavailableTotal)||result.unavailableTotal<result.unavailable.length||result.unavailable.some(item=>!validReferenceOwner(item)||typeof item.code!=='string')||result.partial!==(result.unavailableTotal>0))invalid();
  return result;
 }
 return {owners,query,labels,resolve,incoming,cancel,sync};
}
