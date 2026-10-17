import {researchContext,researchOwner} from './project-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';

const collections=new Set(['profiles','sections','fields','choices']);
const clone=value=>structuredClone(value);
const pinKey=pin=>JSON.stringify(pin?[pin.workspaceId,pin.projectId,pin.notebookId,pin.slot,pin.snapshotId,pin.revision]:null);
export const sameConfigurationPin=(a,b)=>pinKey(a)===pinKey(b);
export const validConfigurationPin=pin=>Boolean(pin&&researchId(pin.workspaceId)&&researchId(pin.projectId)&&(pin.notebookId===null||researchId(pin.notebookId))&&['configuration','labBookTemplate'].includes(pin.slot)&&revisionId(pin.snapshotId)&&revisionId(pin.revision));
const ownerKey=value=>JSON.stringify([value.workspaceId,value.projectId,value.notebookId,value.slot]);
const invalid=()=>Error(t('configurationEditor','invalid'));
const cancelled=()=>new DOMException('Configuration selection changed','AbortError');
const definite=reason=>['INVALID','CONFLICT','NOT_FOUND','PRIVACY','LIMIT'].includes(reason.code);

// Children remain owned by their collection, never by a partial replacement.
export function configurationDocumentClient({state,api,onChange=()=>{}}){
 let owner=null,transportOwner=null,context=null,envelope=null,generation=0,timer=null,serial=Promise.resolve(),pending=null,transition=null,error=null;
 const edits=new Map();
 const current=(epoch,stamp)=>generation===epoch&&context===stamp&&researchContext(state)===stamp;
 const snapshot=()=>JSON.stringify([context,owner&&ownerKey(owner),pinKey(envelope?.configurationPin),envelope?.draft?.id??null,envelope?.draft?.revision??null]);
 const dirty=()=>Boolean(edits.size||pending||transition||envelope?.draft?.dirty);
 const busy=()=>Boolean(pending||transition);
 function notify(){onChange({dirty:dirty(),busy:busy(),error,envelope});}
 function validate(result){
  if(!result||result.configurationPin!==null&&(!validConfigurationPin(result.configurationPin)||ownerKey(result.configurationPin)!==ownerKey(owner))||!result.header||!['profiles','sections','fields','choices'].every(name=>Number.isSafeInteger(result.header.counts?.[name])&&result.header.counts[name]>=0)||result.draft&&(!researchId(result.draft.id)||!revisionId(result.draft.revision)||typeof result.draft.dirty!=='boolean'))throw invalid();
  return result;
 }
 function adopt(result){envelope=validate(result);error=null;notify();return envelope;}
 function stop(){
  clearTimeout(timer);timer=null;generation++;owner=transportOwner=context=envelope=pending=transition=error=null;edits.clear();serial=Promise.resolve();
 }
 async function request(operation,data={},options={}){
  if(!owner)throw cancelled();const epoch=generation,stamp=context;
  try{
   const result=await api('/api/research/configurations/'+operation,{...owner,configurationPin:envelope?.configurationPin??null,...data},{adopt:false,owner:transportOwner,...options});
   if(!current(epoch,stamp))throw cancelled();return result;
  }catch(reason){if(!current(epoch,stamp))throw cancelled();throw reason;}
 }
 async function open(value,{configurationPin=null,signal,saved=false,owner:routeOwner=researchOwner(state)}={}){
  stop();owner=clone(value);transportOwner=routeOwner;context=researchContext(state);
  return adopt(await request('open',{configurationPin,...(saved?{saved:true}:{})},{signal}));
 }
 function readTarget(){return envelope?.draft?{draftId:envelope.draft.id,draftRevision:envelope.draft.revision}:{};}
 async function read(operation,data,{signal}={}){
  await flush();const stamp=snapshot(),result=await request(operation,{...readTarget(),...data},{signal});
  if(stamp!==snapshot())throw cancelled();
  if(!sameConfigurationPin(result.configurationPin,envelope.configurationPin)||(result.draft?.id??null)!==(envelope.draft?.id??null)||(result.draft?.revision??null)!==(envelope.draft?.revision??null))throw invalid();return result;
 }
 async function window(collection,{offset=0,limit=20,signal,...selectors}={}){
  if(!collections.has(collection))throw invalid();
  const result=await read('window',{collection,offset,limit,...selectors},{signal});
  if(!Array.isArray(result.rows)||result.rows.length>limit||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset+result.rows.length>result.total||result.next!==null&&(!Number.isSafeInteger(result.next)||result.next<=result.offset))throw invalid();
  return result;
 }
 async function item(collection,key,{signal,...selectors}={}){
  if(!collections.has(collection))throw invalid();
  const response=await read('item',{collection,key,...selectors},{signal}),result=response.item;
  if(!result){const reason=invalid();reason.code='NOT_FOUND';throw reason;}
  if(result.key!==key||!Number.isSafeInteger(result.position)||result.position<0||!revisionId(result.revision)||!Object.hasOwn(result,'value'))throw invalid();return result;
 }
 const address=operation=>JSON.stringify([operation.type,operation.collection??null,operation.sectionId??null,operation.fieldKey??null,operation.key??null]);
 function changed(operation){
  if(!envelope)throw cancelled();edits.set(address(operation),clone(operation));error=null;clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),600);notify();
 }
 function exclusive(operation){const task=serial.then(operation);serial=task.catch(()=>{});return task;}
 function command(operations){return {draftId:envelope.draft?.id??null,expectedRevision:envelope.draft?.revision??null,commandId:crypto.randomUUID(),...(operations?{operations}:{})};}
 async function finishPending(){
  if(!pending)return;const captured=pending;
  try{
   const result=await request('change',captured.command);
   // An acknowledgement covers only captured values. Later typing stays queued.
   for(const [key,value] of captured.edits)if(edits.get(key)===value)edits.delete(key);
   pending=null;adopt(result);
  }catch(reason){if(pending===captured){if(definite(reason))pending=null;error=reason;notify();}throw reason;}
 }
 async function finishTransition(){
  if(!transition)return null;const captured=transition;
  try{const result=await request(captured.operation,captured.command);transition=null;return adopt(result);}
  catch(reason){if(transition===captured){if(definite(reason))transition=null;error=reason;notify();}throw reason;}
 }
 function flush(){
  clearTimeout(timer);timer=null;const epoch=generation;
  return exclusive(async()=>{
   if(epoch!==generation)throw cancelled();
   if(transition)await finishTransition();
   while(envelope&&(pending||edits.size)){
    if(!pending){const batch=[...edits].slice(0,32);pending={edits:batch,command:command(batch.map(([,value])=>clone(value)))};}
    await finishPending();if(epoch!==generation)throw cancelled();
   }
   notify();return envelope;
  });
 }
 async function perform(operations){
  const retry=transition?.operation==='change'&&JSON.stringify(transition.command.operations)===JSON.stringify(operations);
  await flush();if(retry)return envelope;
  return exclusive(async()=>{transition={operation:'change',command:command(clone(operations))};notify();return finishTransition();});
 }
 async function save(){
  const retry=transition?.operation==='save';await flush();if(retry)return envelope;
  return exclusive(async()=>{if(!envelope.draft)return envelope;transition={operation:'save',command:command()};notify();return finishTransition();});
 }
 async function discard(){
  clearTimeout(timer);timer=null;
  return exclusive(async()=>{
   if(transition){const previous=transition.operation,result=await finishTransition();if(previous==='discard')return result;}
   // Resolve unknown checkpoint outcomes before discarding the exact durable head.
   if(pending)try{await finishPending();}catch(reason){if(!definite(reason))throw reason;}
   edits.clear();if(!envelope?.draft){error=null;notify();return envelope;}transition={operation:'discard',command:command()};notify();return finishTransition();
  });
 }
 async function checkpoint(){await flush();return {configurationPin:envelope.configurationPin,configurationDraft:envelope.draft?{id:envelope.draft.id,revision:envelope.draft.revision}:null};}
 async function section(selectors,{signal}={}){const result=await read('section',selectors,{signal});return result.item;}
 async function profiles(ids,{signal}={}){return read('profiles',{ids},{signal});}
 return {open,stop,window,item,section,profiles,changed,flush,perform,save,discard,checkpoint,snapshot,isDirty:dirty,busy,error:()=>error,descriptor:()=>envelope,owner:()=>owner};
}
