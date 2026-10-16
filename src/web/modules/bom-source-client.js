import {bomSourceAccess} from './bom-connections-client.js';
import {moduleReferenceClient,validReferenceOwner} from './reference-client.js';
import {bomResourceKey,validBOMResource} from './bom-model.js';
import {decimal} from './quantities.js';
const aborted=()=>new DOMException('BOM stock selection changed','AbortError');
const invalid=()=>{throw Error('BOM_STOCK_RESPONSE');};
const same=(a,b)=>!!a&&!!b&&bomResourceKey(a)===bomResourceKey(b);
const placement=value=>value&&Object.hasOwn(value,'id')&&(value.id===null||typeof value.id==='string')&&typeof value.title==='string';
export function bomSourceClient({state,api,access:requestAccess=run=>run(),identity=()=>state.modulePath,active=()=>state.page==='module'&&state.moduleId==='resources'}){
 const access=bomSourceAccess({state,api,access:requestAccess});
 let epoch=0;const requests=new Set();
 const available=()=>active()&&!state.access?.locked&&!state.storageUnavailable;
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,identity()]);
 const references=moduleReferenceClient({state,access,identity,active,api:(path,body,options)=>api(path,path.endsWith('/references/query')?{...body,kind:'material'}:body,options)});
 function cancel(){epoch++;for(const controller of requests)controller.abort();requests.clear();references.cancel();}
 function verify(item,reference,scopeIds){
  if(!same(item?.reference,reference)||!validReferenceOwner(item.owner)||item.owner.workspaceId!==reference.workspaceId||item.resource?.id!==reference.id||!Number.isSafeInteger(item.resource.revision)||item.resource.revision<1||item.resource.data?.kind!=='material'||typeof item.resource.data.name!=='string'||typeof item.resource.data.unit!=='string'||!['available','hold','retired'].includes(item.resource.data.status)||!Array.isArray(item.placements)||item.placements.length>25||item.placements.some(value=>!placement(value))||new Set(item.placements.map(value=>value.id)).size!==item.placements.length||!Number.isSafeInteger(item.placementTotal)||item.placementTotal<item.placements.length||item.placementNextOffset!==null&&(!Number.isSafeInteger(item.placementNextOffset)||item.placementNextOffset<1)||!Array.isArray(item.selectedPlacements)||item.selectedPlacements.length!==scopeIds.length||item.selectedPlacements.some(value=>!placement(value)||!scopeIds.includes(value.id))||new Set(item.selectedPlacements.map(value=>value.id)).size!==scopeIds.length||item.stock?.id!==reference.id||item.stock.revision!==item.resource.revision||!Array.isArray(item.stock.locations)||item.stock.locations.length>scopeIds.length||item.stock.locations.some(value=>!scopeIds.includes(value.projectId)||!['physical','reserved','available'].every(key=>decimal(value[key]))))invalid();
  return item;
 }
 async function stock(selected,{scopeIds=[null],placementOffset=0,signal,unlock=false}={}){
  const bulk=Array.isArray(selected),values=bulk?selected:[selected];
  if(!values.length||values.length>25||values.some(value=>!validBOMResource(value)||typeof value!=='object'||!value)||new Set(values.map(bomResourceKey)).size!==values.length||values.some(value=>value.workspaceId!==values[0].workspaceId)||!scopeIds.length||scopeIds.length>25||new Set(scopeIds).size!==scopeIds.length)throw TypeError('Invalid BOM stock request');
  if(!available())throw aborted();const stamp=context(),version=epoch,workspaceId=state.book.id,controller=new AbortController();requests.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,current=()=>available()&&!combined.aborted&&version===epoch&&stamp===context();
  const run=async()=>{
   if(!current())throw aborted();
   try{
    const result=await api('/api/modules/bom/stock',{workspaceId,...(bulk?{references:values}:{reference:selected}),scopeIds,placementOffset},{adopt:false,signal:combined});if(!current())throw aborted();
    if(result?.workspaceId!==workspaceId)invalid();
    if(bulk){if(!Array.isArray(result.items)||result.items.length!==values.length||new Set(result.items.map(item=>item.reference&&bomResourceKey(item.reference))).size!==values.length)invalid();for(const reference of values)verify(result.items.find(item=>same(item.reference,reference)),reference,scopeIds);}
    else verify(result,selected,scopeIds);
    return result;
   }catch(error){if(!current())throw aborted();throw error;}
  };
  try{const result=await(unlock?access(run):run());if(!current())throw aborted();return result;}finally{requests.delete(controller);}
 }
 return {stock,cancel,owners:references.owners,query:references.query,resolve:references.resolve,sync:references.sync};
}
