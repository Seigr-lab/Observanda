import {websiteSnapshot} from './website-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';

const aborted=()=>new DOMException('Publication source changed','AbortError');
const invalid=()=>{throw Error('PUBLICATION_SOURCE_RESPONSE');};
const nullableId=value=>value===null||researchId(value);
const ownerValid=owner=>owner&&researchId(owner.workspaceId)&&nullableId(owner.projectId)&&nullableId(owner.labBookId)&&(!owner.labBookId||owner.projectId);
const sameOwner=(a,b)=>a.workspaceId===b.workspaceId&&a.projectId===b.projectId&&a.labBookId===b.labBookId;
const headValid=value=>value&&revisionId(value.snapshotId)&&typeof value.title==='string'&&Array.isArray(value.projects)&&Array.isArray(value.notebooks)&&
 value.projects.every(p=>researchId(p.id)&&typeof p.title==='string'&&nullableId(p.parentId)&&typeof p.share==='boolean')&&new Set(value.projects.map(p=>p.id)).size===value.projects.length&&
 value.notebooks.every(n=>researchId(n.id)&&typeof n.title==='string'&&value.projects.some(p=>p.id===n.projectId))&&new Set(value.notebooks.map(n=>n.id)).size===value.notebooks.length;

// One selected source owns one immutable head. Source replies never replace
// the website owner's document, and a context change cancels every pending read.
export function publicationSourceClient({state,api,access=operation=>operation()}){
 let context=null,epoch=0,selected=null,opening=null;
 const controllers=new Set();
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,state.etag]);
 const active=()=>state.page==='website'&&!state.access?.locked&&!state.storageUnavailable;
 function cancel(){epoch++;for(const controller of controllers)controller.abort();controllers.clear();opening=null;}
 function close(){cancel();selected=null;context=null;}
 function sync(){const current=identity();if(context!==current||!active()){cancel();selected=null;context=current;}return context;}
 function route(){const owner=state.projectOwner;return '/api/projects/'+(owner?.projectId?owner.projectId+'/'+(owner.labBookId?'lab-books/'+owner.labBookId+'/':''):'');}
 async function request(endpoint,body,{signal,unlock=false}={}){
  sync();if(!active())throw aborted();
  const stamp=context,version=epoch,path=route()+endpoint,controller=new AbortController();controllers.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const valid=()=>!combined.aborted&&version===epoch&&stamp===identity()&&active();
  const run=()=>{if(!valid())throw aborted();return api(path,body,{adopt:false,signal:combined});};
  try{const result=await (unlock?access(run):run());if(!valid())throw aborted();return result;}
  finally{controllers.delete(controller);}
 }
 async function directory({projectId=null,search='',offset=0,limit=20,revision=null}={},options={}){
  sync();const workspaceId=state.book.id;
  const result=await request('publication-source-directory',{workspaceId,projectId,search,offset,limit,revision},options);
  if(result?.workspaceId!==workspaceId||result.projectId!==projectId||!revisionId(result.revision)||!Array.isArray(result.items)||result.items.length>limit||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||result.items.length!==Math.min(limit,Math.max(0,result.total-offset))||
   result.items.some(item=>!ownerValid(item)||!['workspace','project','content','book'].includes(item.kind)||typeof item.label!=='string'||!Array.isArray(item.ancestors)||item.ancestors.some(label=>typeof label!=='string')||item.kind==='book'&&!item.labBookId||['project','content'].includes(item.kind)&&(!item.projectId||item.labBookId)||item.kind==='workspace'&&(item.projectId||item.labBookId)||projectId!==null&&item.projectId!==projectId)||new Set(result.items.map(item=>item.workspaceId)).size!==result.items.length)invalid();
  return result;
 }
 async function open(owner,options={}){
  sync();if(!ownerValid(owner)||owner.workspaceId===state.book.id||options.snapshotId!==undefined&&!revisionId(options.snapshotId))throw new TypeError('Invalid publication source');
  cancel();selected=null;const version=epoch,host=state.book.id,target={workspaceId:owner.workspaceId,projectId:owner.projectId,labBookId:owner.labBookId};opening=target;
  try{
   const result=await request('publication-source',{workspaceId:host,sourceId:target.workspaceId,operation:'head',query:options.snapshotId?{snapshotId:options.snapshotId}:{}},options);
   if(version!==epoch)throw aborted();
   if(!ownerValid(result?.owner)||!sameOwner(result.owner,target)||result.value?.workspaceId!==target.workspaceId||!headValid(result.value)||options.snapshotId&&result.value.snapshotId!==options.snapshotId)invalid();
   selected={owner:target,head:structuredClone(result.value)};return structuredClone(selected);
  }finally{if(version===epoch)opening=null;}
 }
 async function query(operation,data,options={}){
  sync();if(!selected||!['summary','content','record','sections','media'].includes(operation))throw new TypeError('No selected publication source');
  const source=selected,host=state.book.id;
  const query={...data,workspaceId:source.owner.workspaceId,snapshotId:source.head.snapshotId};
  const result=await request('publication-source',{workspaceId:host,sourceId:source.owner.workspaceId,operation,query},options);
  if(source!==selected)throw aborted();
  if(!ownerValid(result?.owner)||!sameOwner(result.owner,source.owner)||result.value?.workspaceId!==source.owner.workspaceId||result.value.snapshotId!==source.head.snapshotId)invalid();
  return result.value;
 }
 return {directory,open,query,close,sync,current(){sync();return selected?structuredClone(selected):null;},opening(){sync();return opening?{...opening}:null;}};
}
