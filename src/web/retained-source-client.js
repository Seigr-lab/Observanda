import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './material-reference.js';
import {projectApiRoute,researchOwner} from './project-context.js';
const owner=value=>value&&researchId(value.workspaceId)&&(value.projectId===null||researchId(value.projectId))&&(value.labBookId===null||researchId(value.labBookId))&&(!value.labBookId||!!value.projectId);
const reference=value=>validMaterialReference(value)&&researchId(value.workspaceId);
const token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=8192;
const invalid=()=>{throw Error('RETAINED_SOURCE_RESPONSE');};
const aborted=()=>new DOMException('Retained source selection changed','AbortError');
// Source lookup belongs to the result owner. Reading a destination never adopts
// its research or creates a mutable pointer to the selected immutable revision.
export function retainedSourceClient({state,api,access=run=>run(),identity=()=>null,active=()=>true}){
 let epoch=0;const requests=new Set();
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,researchOwner(state),identity()]);
 const available=()=>active()&&!state.access?.locked&&!state.storageUnavailable;
 function cancel(){epoch++;for(const request of requests)request.abort();requests.clear();}
 async function request(endpoint,body,{signal,unlock=false}={}){
  if(!available())throw aborted();
  const stamp=context(),version=epoch,workspaceId=state.book.id,resultOwner=structuredClone(researchOwner(state)),controller=new AbortController();requests.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const current=()=>!combined.aborted&&version===epoch&&stamp===context()&&available();
  const run=async()=>{if(!current())throw aborted();try{const result=await api(projectApiRoute('/api/research/materials/source-'+endpoint,resultOwner),{...body,workspaceId},{owner:resultOwner,adopt:false,signal:combined});if(!current())throw aborted();return result;}catch(error){if(!current())throw aborted();throw error;}};
  try{const result=await(unlock?access(run):run());if(!current())throw aborted();if(result?.workspaceId!==workspaceId)invalid();return result;}finally{requests.delete(controller);}
 }
 async function owners({projectId=null,search='',offset=0,limit=25,revision=null}={},options={}){
  const result=await request('owners',{projectId,search,offset,limit,revision},options);
  if(result.projectId!==projectId||!revisionId(result.revision)||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||!Array.isArray(result.items)||result.items.length>limit||result.items.length!==Math.min(limit,Math.max(0,result.total-offset))||result.items.some(item=>!owner(item)||!['workspace','project','lab-book'].includes(item.kind)||typeof item.label!=='string'||!Array.isArray(item.ancestors)||item.ancestors.some(name=>typeof name!=='string')||projectId!==null&&item.projectId!==projectId)||new Set(result.items.map(item=>item.workspaceId)).size!==result.items.length)invalid();return result;
 }
 async function items({sourceId,kind,query='',cursor=null,limit=25},options={}){
  const result=await request('items',{sourceId,kind,query,cursor,limit},options);
  if(result.sourceId!==sourceId||!owner(result.owner)||result.owner.workspaceId!==sourceId||!Array.isArray(result.items)||result.items.length>limit||result.items.some(item=>!reference(item.reference)||item.reference.workspaceId!==sourceId||item.reference.kind!==kind||typeof item.title!=='string')||new Set(result.items.map(item=>materialReferenceKey(item.reference))).size!==result.items.length||!token(result.next)||typeof result.changed!=='boolean'||!Number.isSafeInteger(result.scanned)||result.scanned<0)invalid();return result;
 }
 async function resolve(ref,options={}){
  if(!reference(ref))throw new TypeError('Invalid retained source');
  const result=await request('resolve',{ref:materialReference(ref)},options);
  if(!reference(result.reference)||materialReferenceKey(result.reference)!==materialReferenceKey(ref)||!owner(result.owner)||typeof result.title!=='string')invalid();return result;
 }
 return {owners,items,resolve,cancel};
}
