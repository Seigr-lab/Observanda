import {researchContext} from './project-context.js';
import {validWebsitePin,sameWebsitePin} from './website-pin.js';
import {revisionId} from './revision-model.js';
import {researchId} from './research-reference.js';
import {sameJSONData} from './json-data-equality.js';
import {t} from './i18n/index.js';

const collections=['pages','navigation','assets','layouts','branding'];
const overrides=new Set(['layouts','branding']);
const keyOf=(collection,value)=>['navigation','layouts','branding'].includes(collection)?value.target:value.id;
const values=(book,collection)=>collection==='branding'?book.branding:collection==='pages'?book.pages:book.website[collection];
const copy=value=>structuredClone(value);
const failure=key=>Error(t('websiteEditor',key));
// The authoritative compact document never contains collection arrays. Only
// selected values enter the rendering book; this owner alone submits changes.
export function websiteDocumentClient({state,api,selection,onStatus=()=>{}}){
 let envelope=null,outline=null,context=null,generation=0,timer=null,queue=Promise.resolve(),pending=null,actionPending=null,lastActionResult=null,error='',local=false,editVersion=0,viewVersion=0;
 let settings=null,pageKey=null,pageSelection=0;const activeOverrides=new Map();const selected=new Map(collections.map(name=>[name,new Map()]));
 const owner=()=>JSON.stringify([researchContext(state),state.book?.id]);
 const enabled=()=>Boolean(envelope&&context===owner()&&state.websiteEditor);
 const snapshot=()=>enabled()?JSON.stringify([context,envelope.websitePin,envelope.draft?.id??null,envelope.draft?.revision??null,editVersion]):null;
 const count=name=>envelope?.collections[name]?.count??0;
 const current=(stamp,epoch)=>stamp===context&&epoch===generation&&stamp===owner();
 function validate(result,pin=envelope?.websitePin){
  if(!result||!validWebsitePin(result.websitePin)||pin&&result.websitePin.websiteId!==pin.websiteId||!result.site?.document||collections.some(name=>!Number.isSafeInteger(result.collections?.[name]?.count)||result.collections[name].count<0)||['pages','branding'].some(name=>Object.hasOwn(result.site.document,name))||['navigation','assets','layouts'].some(name=>Object.hasOwn(result.site.document.website??{},name))||result.draft&&(!revisionId(result.draft.revision)||!researchId(result.draft.id)||typeof result.draft.dirty!=='boolean'))throw failure('documentInvalid');
  return result;
 }
 const common=()=>({workspaceId:outline.book.id,websiteId:envelope.websitePin.websiteId,websitePin:envelope.websitePin});
 const readTarget=()=>({...common(),...(envelope.draft?{draftId:envelope.draft.id,draftRevision:envelope.draft.revision}:{})});
 function stop(){clearTimeout(timer);timer=null;generation++;pending=null;actionPending=null;queue=Promise.resolve();envelope=outline=settings=null;context=null;local=false;error='';pageKey=null;pageSelection++;activeOverrides.clear();for(const map of selected.values())map.clear();}
 function compact(book=state.book){
  const {assets,navigation,layouts,...website}=book.website;void assets;void navigation;void layouts;
  return {document:{website,...Object.fromEntries(['appearance','themes','activeThemeId'].map(key=>[key,book[key]]))},projects:book.projects.map(({id,share,logoId})=>({id,share,logoId})),selection:selection.snapshot()};
 }
 function project(){
  const site=envelope.site,base=envelope.research?.metadata??outline.book,projects=base.projects.map(project=>({...project,share:false,...site.projects.find(value=>value.id===project.id)})),ids=new Set(projects.map(project=>project.id));
  return {...base,...copy(site.document),projects,notebooks:base.notebooks.filter(book=>ids.has(book.projectId)),entries:[],website:{...copy(site.document.website),navigation:[],assets:[],layouts:[]},pages:[],branding:[]};
 }
 function receipt(){return {...outline,...envelope,outline:true,etag:envelope.websitePin.researchSnapshotId,websitePin:envelope.websitePin,site:{...envelope.site,id:envelope.websitePin.websiteId},websiteEditor:envelope,book:project(),recordRevisions:{}};}
 function status(){if(enabled())state.websiteEditor=envelope;onStatus({dirty:isDirty(),error,busy:Boolean(local||pending||actionPending)});}
 function adopt(result,{replace=false}={}){
  envelope=validate(result);state.websiteEditor=envelope;state.websitePin=envelope.websitePin;state.websiteId=envelope.websitePin.websiteId;state.website={...envelope.site,id:state.websiteId};state.etag=envelope.websitePin.researchSnapshotId;
  if(replace){viewVersion++;state.book=project();selection.load(envelope.site.selection,envelope.selectionProjects??outline.selectionProjects);settings=copy(compact());for(const map of selected.values())map.clear();}
  status();return result;
 }
 async function request(operation,data,{signal}={}){
  const stamp=context,epoch=generation,pin=envelope.websitePin;
  const result=await api('/api/websites/editor/'+operation,{...common(),...data},{adopt:false,signal,websitePin:pin}).catch(reason=>{if(!current(stamp,epoch))throw new DOMException('Website editor changed','AbortError');throw reason;});
  if(!current(stamp,epoch))throw new DOMException('Website editor changed','AbortError');return result;
 }
 async function open({websiteId,websitePin,base,signal}){
  stop();viewVersion++;outline=base;context=owner();const stamp=context,epoch=generation;
  const result=await api('/api/websites/editor/open',{workspaceId:base.book.id,websiteId,websitePin},{adopt:false,signal,websitePin});
  if(!current(stamp,epoch))throw new DOMException('Website editor changed','AbortError');envelope=validate(result,websitePin);
  const resultSnapshot=receipt();await readOverride('branding','home',{signal,book:resultSnapshot.book});if(!current(stamp,epoch))throw new DOMException('Website editor changed','AbortError');settings=copy({document:envelope.site.document,projects:envelope.site.projects,selection:envelope.site.selection});return resultSnapshot;
 }
 function installed(){if(!envelope)return;state.websiteEditor=envelope;settings=copy(compact());status();}
 function remember(collection,item,book=state.book){
  if(!item||typeof item.key!=='string'||!Number.isSafeInteger(item.position)||item.position<0||!item.value||keyOf(collection,item.value)!==item.key)throw failure('documentInvalid');
  const value=copy(item.value),map=selected.get(collection);map.delete(item.key);map.set(item.key,{...item,base:copy(value)});
  const list=values(book,collection),index=list.findIndex(value=>keyOf(collection,value)===item.key);if(index<0)list.push(value);else list[index]=value;
  trim(collection,book);return value;
 }
 function trim(collection,book=state.book){
  const map=selected.get(collection),list=values(book,collection);
  while(map.size>64){const oldest=[...map.keys()].find(key=>key!==activeOverrides.get(collection)&&!(collection==='branding'&&key==='home'));map.delete(oldest);const at=list.findIndex(item=>keyOf(collection,item)===oldest);if(at>=0)list.splice(at,1);}
 }
 function rememberMissing(collection,key,book=state.book){
  const map=selected.get(collection),list=values(book,collection),at=list.findIndex(item=>keyOf(collection,item)===key);if(at>=0)list.splice(at,1);
  map.delete(key);map.set(key,{key,position:count(collection),revision:null,base:null});trim(collection,book);
 }
 async function readOverride(collection,key,{signal,book=state.book,target=readTarget()}={}){
  try{const result=await request('item',{...target,collection,key},{signal});if(!sameWebsitePin(result.websitePin,target.websitePin)||result.key!==key)throw failure('documentInvalid');return remember(collection,result,book);}
  catch(reason){if(reason.code!=='NOT_FOUND')throw reason;rememberMissing(collection,key,book);return null;}
 }
 const hasSelected=(collection,key)=>selected.get(collection)?.has(key)??false;
 async function selectOverride(collection,key,{signal}={}){
  if(!overrides.has(collection))throw failure('documentInvalid');await flush();activeOverrides.set(collection,key);
  if(hasSelected(collection,key))return values(state.book,collection).find(item=>item.target===key)??null;
  const stamp=snapshot(),book=state.book;
  // Adopt only while the same selected draft and rendering book are still current.
  const result=await request('item',{...readTarget(),collection,key},{signal}).catch(reason=>{if(reason.code==='NOT_FOUND')return null;throw reason;});
  if(stamp!==snapshot()||book!==state.book)throw new DOMException('Website draft changed','AbortError');
  if(result){if(!sameWebsitePin(result.websitePin,envelope.websitePin)||result.key!==key)throw failure('documentInvalid');return remember(collection,result);}
  rememberMissing(collection,key);return null;
 }
 function editableOverride(collection,key,create){
  if(!overrides.has(collection)||!hasSelected(collection,key))throw failure('documentLoading');activeOverrides.set(collection,key);
  const list=values(state.book,collection);let value=list.find(item=>item.target===key);if(!value){value=create();if(value.target!==key)throw failure('documentInvalid');list.push(value);}return value;
 }
 async function item(collection,key,{signal,retain=true}={}){
  await flush();const stamp=snapshot(),result=await request('item',{...readTarget(),collection,key},{signal});
  if(stamp!==snapshot())throw new DOMException('Website draft changed','AbortError');
  if(!sameWebsitePin(result.websitePin,envelope.websitePin)||result.key!==key)throw failure('documentInvalid');if(retain)remember(collection,result);return result;
 }
 async function window(collection,{offset=0,limit=25,search='',kind='all',signal}={}){
  await flush();const stamp=snapshot(),result=await request('window',{...readTarget(),collection,offset,limit,search,...(collection==='assets'?{kind}:{})},{signal});
  if(stamp!==snapshot())throw new DOMException('Website draft changed','AbortError');
  result.items=result.rows;
  if(!sameWebsitePin(result.websitePin,envelope.websitePin)||!Array.isArray(result.items)||result.items.length>limit||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.offset))throw failure('documentInvalid');return result;
 }
 async function selectPage(key,{signal}={}){
  const request=++pageSelection;await flush();const result=key?await item('pages',key,{signal,retain:false}):null;
  if(request!==pageSelection)throw new DOMException('Page selection changed','AbortError');
  selected.get('pages').clear();state.book.pages=[];pageKey=key;if(result)remember('pages',result);return result?.value??null;
 }
 async function replaceWindow(collection,items){
  await flush();selected.get(collection).clear();values(state.book,collection).length=0;
  for(const item of items)remember(collection,item);
 }
 function changes(){
  if(!enabled())return [];
  const next=compact(),operations=[];
  for(const key of new Set([...Object.keys(settings.document.website),...Object.keys(next.document.website)]))if(!sameJSONData(settings.document.website[key],next.document.website[key]))operations.push({type:'settings',path:['document','website',key],...(next.document.website[key]===undefined?{remove:true}:{value:copy(next.document.website[key])})});
  for(const key of ['appearance','themes','activeThemeId'])if(!sameJSONData(settings.document[key],next.document[key]))operations.push({type:'settings',path:['document',key],value:copy(next.document[key])});
  for(const key of ['projects','selection'])if(!sameJSONData(settings[key],next[key]))operations.push({type:'settings',path:[key],value:copy(next[key])});
  for(const collection of collections)for(const [key,saved] of selected.get(collection)){
   const value=values(state.book,collection).find(value=>keyOf(collection,value)===key);
   if(value&&!sameJSONData(value,saved.base))operations.push(saved.base===null&&!overrides.has(collection)?{type:'append',collection,values:[copy(value)]}:{type:'replace',collection,key,value:copy(value)});
  }
  return operations;
 }
 function acknowledge(operations){
  for(const operation of operations){
   if(operation.type==='settings'){let object=settings;for(const key of operation.path.slice(0,-1))object=object[key];if(operation.remove)delete object[operation.path.at(-1)];else object[operation.path.at(-1)]=copy(operation.value);}
   else if(operation.type==='append'){for(const item of operation.values){const value=selected.get(operation.collection).get(keyOf(operation.collection,item));if(value)value.base=copy(item);}}
   else if(operation.type==='replace'){const value=selected.get(operation.collection).get(operation.key);if(value)value.base=copy(operation.value);}
  }
 }
 function changed(){if(!enabled())return;editVersion++;local=true;error='';clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),600);status();}
 const isDirty=()=>Boolean(local||pending||actionPending||envelope?.draft?.dirty);
 function flush(){
  clearTimeout(timer);timer=null;const epoch=generation;
  const task=queue.then(async()=>{
   while(enabled()&&epoch===generation){
    if(actionPending)await finishAction();
    const operations=pending?.operations??changes().slice(0,32);if(!operations.length){local=false;error='';status();return;}
    pending??={draftId:envelope.draft?.id??null,expectedRevision:envelope.draft?.revision??null,commandId:crypto.randomUUID(),operations};status();
    try{const result=await request('change',pending);acknowledge(pending.operations);pending=null;error='';adopt(result);local=changes().length>0;}
    catch(reason){if(epoch===generation){if(['INVALID','LIMIT','CONFLICT','PRIVACY','NOT_FOUND','WEBSITE_NAME_EXISTS'].includes(reason.code))pending=null;error=reason.message??t('websiteEditor','documentCheckpointFailed');status();}throw reason;}
   }
  });queue=task.catch(()=>{});return task;
 }
 function restoreEdits(operations,bases){
  for(const operation of operations){
   if(operation.type==='settings'){let object=operation.path[0]==='document'?state.book:null;const path=operation.path[0]==='document'?operation.path.slice(1):operation.path;if(!object){if(path[0]==='selection'){selection.restore(operation.value);continue;}object=state.book;}for(const key of path.slice(0,-1))object=object[key];if(operation.remove)delete object[path.at(-1)];else object[path.at(-1)]=copy(operation.value);}
   else for(const value of operation.type==='append'?operation.values:[operation.value]){const key=keyOf(operation.collection,value),base=bases.get(operation.collection).get(key);if(!base)continue;selected.get(operation.collection).set(key,base);const list=values(state.book,operation.collection),at=list.findIndex(item=>keyOf(operation.collection,item)===key);if(at<0)list.push(copy(value));else list[at]=copy(value);}
  }
  local=operations.length>0;if(local)changed();else status();
 }
 function exclusive(operation){const task=queue.then(operation);queue=task.catch(()=>{});return task;}
 async function finishAction(){
  const command=actionPending;let result;
  try{result=await request(command.operation,command.payload);}catch(reason){if(['INVALID','LIMIT','CONFLICT','PRIVACY','NOT_FOUND','WEBSITE_NAME_EXISTS'].includes(reason.code))actionPending=null;local=changes().length>0;error=reason.message??t('websiteEditor','documentCheckpointFailed');status();throw reason;}
  actionPending=null;error='';let page=null;const selectedKey=pageKey;
  if(selectedKey)try{page=await request('item',{websitePin:result.websitePin,...(result.draft?{draftId:result.draft.id,draftRevision:result.draft.revision}:{}),collection:'pages',key:selectedKey});}catch(reason){if(reason.name==='AbortError')throw reason;if(reason.code==='NOT_FOUND')pageKey=null;else error=reason.message;}
  const overrideRows=[];
  for(const collection of overrides)for(const key of new Set([...(collection==='branding'?['home']:[]),activeOverrides.get(collection)].filter(Boolean))){
   try{const item=await request('item',{websitePin:result.websitePin,...(result.draft?{draftId:result.draft.id,draftRevision:result.draft.revision}:{}),collection,key});overrideRows.push({collection,key,item});}
   catch(reason){if(reason.name==='AbortError')throw reason;if(reason.code==='NOT_FOUND')overrideRows.push({collection,key,item:null});else error=reason.message;}
  }
  // Typing during an acknowledged save belongs to the next checkpoint.
  const later=command.discard?[]:changes(),bases=new Map([...selected].map(([name,map])=>[name,new Map(map)]));
  local=false;adopt(result,{replace:true});if(page)remember('pages',page);for(const {collection,key,item} of overrideRows)if(item)remember(collection,item);else rememberMissing(collection,key);restoreEdits(later,bases);
  lastActionResult=['save','discard'].includes(command.operation)?{...receipt(),book:state.book}:result;return lastActionResult;
 }
 async function transition(operation,operations){
  const retrying=actionPending?.operation===operation&&sameJSONData(actionPending.payload.operations,operations);
  await flush();if(retrying)return lastActionResult;
  return exclusive(async()=>{
   if(operation!=='change'&&!envelope.draft)return operation==='save'?{...receipt(),book:state.book}:false;
   actionPending={operation,payload:{draftId:envelope.draft?.id??null,expectedRevision:envelope.draft?.revision??null,commandId:crypto.randomUUID(),...(operations?{operations}:{})}};status();return finishAction();
  });
 }
 const perform=operations=>transition('change',operations);
 const history=direction=>transition(direction);
 const save=()=>transition('save');
 async function discard(){
  clearTimeout(timer);timer=null;
  return exclusive(async()=>{
   if(actionPending){const previous=actionPending.operation,result=await finishAction();if(previous==='discard')return result;}
   pending=null;local=false;
   actionPending={operation:'discard',discard:true,payload:{draftId:envelope.draft?.id??null,expectedRevision:envelope.draft?.revision??null,commandId:crypto.randomUUID()}};status();return finishAction();
  });
 }
 async function stageAsset(value){
  await flush();let existing;try{existing=await item('assets',value.id);}catch(reason){if(reason.code!=='NOT_FOUND')throw reason;}
  if(existing)return existing.value;
  const asset=copy(value);selected.get('assets').set(asset.id,{key:asset.id,position:count('assets'),revision:null,base:null});state.book.website.assets.push(asset);return asset;
 }
 async function preview(){await flush();return {websitePin:envelope.websitePin,...(envelope.draft?{websiteDraft:{id:envelope.draft.id,revision:envelope.draft.revision}}:{})};}
 return {open,installed,stop,enabled,snapshot,count,item,window,remember,replaceWindow,selectPage,selectOverride,hasSelected,editableOverride,stageAsset,changed,flush,perform,history,save,discard,preview,isDirty,
  viewKey:()=>JSON.stringify([context,viewVersion]),descriptor:()=>envelope,draft:()=>envelope?.draft??null,error:()=>error,selectedPage:()=>pageKey,
  settingBook:()=>project(),async append(collection,value){await perform([{type:'append',collection,values:[value]}]);if(collection==='pages')await selectPage(value.id);else await item(collection,keyOf(collection,value));return value;}
 };
}