import {sameWebsitePin} from './website-pin.js';
import {websiteContext,websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
const message=key=>t('websiteContent',key);

// Presentation discovery has its own small cache. A displayed label can never
// become a record draft, and moving through pages releases previous originals.
export function websiteResearchClient({state,api,selection,onChange}){
 let context=null,workspace=null,details=null,selectedPage=null,totals=null,pending=null,error='',generation=0,recordRequest=null,recordError=null;
 const controllers=new Set();
 function close(){generation++;for(const controller of controllers)controller.abort();controllers.clear();pending=null;recordRequest=null;}
 const enabled=()=>state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id]);
 function sync(){if(context!==identity()){close();const owner=JSON.stringify([websiteContext(state),state.book?.id]);if(workspace!==owner)selectedPage=null;workspace=owner;context=identity();details=null;recordRequest=null;recordError=null;totals=null;pending=null;error='';generation++;}}
 async function query(operation,data,{signal}={}){
  sync();const key=context,workspaceId=state.book.id,snapshotId=state.etag,websitePin=state.websitePin;
  const controller=new AbortController();controllers.add(controller);signal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let result;try{result=await api('/api/website/research/'+operation,{workspaceId,snapshotId,websitePin,...data},{adopt:false,signal});}finally{controllers.delete(controller);}
  if(signal?.aborted||key!==identity()||state.page!=='website'||state.access?.locked||state.storageUnavailable)throw new DOMException('Website context changed','AbortError');
  if(result?.workspaceId!==workspaceId||result.snapshotId!==snapshotId||websitePin&&!sameWebsitePin(result.websitePin,websitePin))throw Error(message('invalid'));
  return result;
 }
 function record(id){sync();if(details?.id===id)return Promise.resolve(details);if(recordRequest?.id===id)return recordRequest.promise;
  const request={id,epoch:generation};recordRequest=request;recordError=null;
  request.promise=query('record',{recordId:id}).then(result=>{
   if(result.record?.id!==id||typeof result.record.title!=='string'||!researchId(result.record.notebookId)||!Array.isArray(result.record.attachments))throw Error(message('invalid'));
   if(recordRequest===request){details=result.record;if(selectedPage?.id===id)selectedPage.title=details.title;}return result.record;
  }).catch(reason=>{if(recordRequest===request&&reason.name!=='AbortError')recordError={id,message:message('loadFailed')};throw reason;}).finally(()=>{if(recordRequest===request)recordRequest=null;});
  return request.promise;
 }
 function refresh(){
  sync();if(!enabled()||state.page!=='website'||pending)return;
  const epoch=generation,key=JSON.stringify(selection.snapshot());
  pending=query('summary',{selection:selection.snapshot(),search:''}).then(result=>{
   if(epoch!==generation)return;
   if(!Array.isArray(result.projects)||result.projects.length>state.book.projects.length||!Array.isArray(result.notebookIds)||result.notebookIds.some(id=>!researchId(id)))throw Error(message('invalid'));
   totals=result;error='';
  }).catch(reason=>{if(epoch===generation&&reason.name!=='AbortError')error=message('loadFailed');}).finally(()=>{
   if(epoch!==generation)return;pending=null;onChange();if(key!==JSON.stringify(selection.snapshot()))refresh();
  });
 }
 return {enabled,query,record,sync,refresh,close,
  cachedRecord:()=>{sync();return details;},recordError:id=>recordError?.id===id?recordError.message:null,totals:()=>{sync();return totals;},error:()=>error,
  choosePage(item){sync();if(item.target.startsWith('entry:'))selectedPage={id:item.target.slice(6),title:item.title};},
  labels(){sync();return selectedPage?[selectedPage]:[];},
  invalidate(){sync();totals=null;refresh();},
  pageBook(){sync();return enabled()?{...state.book,entries:selectedPage?[selectedPage]:[]}:state.book;}
 };
}
