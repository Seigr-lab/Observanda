import {projectContextAPI} from './project-context.js';
import {proseText} from './prose-model.js';
// Feature-owned data adapters; no dashboard feature list or domain switches.
// An item is {key,title,subtitle?,data,action?:{name,id?},render?:({esc})=>HTML}.
// Providers expose authorized display data, never storage paths or credentials.
// Optional discover({api,context,search,offset,limit,signal}) returns a bounded
// {items:[{key,title,subtitle?}],total,offset} page, independently of card bodies.
// A setting with type:lookup owns loadChoices({api,context,panel,search,cursor,
// signal}); it returns one bounded items/selected/total/offset page with next
// and previous cursors. The inspector cancels it when its context closes.
export function createDataRegistry(){
 const providers=new Map(),listeners=new Set();
 const changed=()=>listeners.forEach(fn=>fn());
 return {
  register(provider){
   if(!provider||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(provider.id)||typeof provider.label!=='string'||typeof provider.items!=='function')throw new TypeError('A data provider needs a stable id, label and items(context, loadedData).');
   if(providers.has(provider.id))throw new Error('Duplicate data provider: '+provider.id);
   const value=Object.freeze({...provider});providers.set(value.id,value);changed();
   return ()=>{if(providers.get(value.id)===value){providers.delete(value.id);changed();}};
  },
  get:id=>providers.get(id),all:()=>[...providers.values()],
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
 };
}
export const workspaceData=createDataRegistry();

// One session per open workspace. Late responses from a closed session cannot
// update the next workspace. Independent providers fail and retry independently.
export function createDataSession(registry,{context,api,onChange,access=operation=>operation()}){
 const cache=new Map();let closed=false;
 const dynamic=p=>typeof p.loadKey==='function';
 const keyFor=(p,ctx)=>dynamic(p)?p.id+':'+(ctx.dataSlot??'default'):p.loadKey??p.id;
 const unsubscribe=registry.subscribe(()=>{
  for(const [key,value] of cache)if(!registry.all().some(p=>dynamic(p)?p.id===value.provider:(p.loadKey??p.id)===key)){value.controller.abort();cache.delete(key);}
  if(!closed)onChange();
 });
 function load(p,ctx,options){
  const key=keyFor(p,ctx),signature=JSON.stringify([ctx.contextId??null,ctx.book?.id??null,ctx.projectOwner?.projectId??null,ctx.projectOwner?.labBookId??null,dynamic(p)?p.loadKey(ctx,options):null]),current=cache.get(key);
  if(!p.load||current&&current.signature===signature&&!current.stale||closed)return;
  current?.controller.abort();
  const retained=current?.signature===signature&&current.status==='ready';
  const state={provider:p.id,slot:dynamic(p)?ctx.dataSlot??'default':null,signature,status:'loading',data:retained?current.data:null,retained,error:null,controller:new AbortController()};cache.set(key,state);
  state.execute=async authorize=>{
   if(closed||cache.get(key)!==state)return;
   const previousError=state.error;state.status='loading';state.error=null;
   try{
    const run=()=>{state.controller.signal.throwIfAborted();return p.load({api:projectContextAPI(api,ctx),context:ctx,options,signal:state.controller.signal});};
    const data=await (authorize?access(run):run());
    if(closed||cache.get(key)!==state)return;state.status='ready';state.data=data;
   }catch(error){if(!closed&&cache.get(key)===state){state.status='error';state.retained=false;state.data=null;state.error=error.name==='AbortError'&&previousError?previousError:error;}}
   finally{if(!closed&&cache.get(key)===state)onChange();}
  };
  void Promise.resolve().then(()=>state.execute(false));
 }
 function invalidate(id,{retainData=false}={}){
  if(closed)return;const p=id?registry.get(id):null;
  for(const [key,value] of cache){
   if(id&&!(dynamic(p??{})?value.provider===id:key===(p?.loadKey??id)))continue;
   // Refresh in place only within the identical workspace, owner and query.
   // Repeated notifications must not restart an already pending refresh.
   if(retainData){if(value.status!=='loading')value.stale=true;}else{value.controller.abort();cache.delete(key);}
  }
  onChange();
 }
 return {
  read(id,ctx=context(),options={}){
   const p=registry.get(id);if(!p)return {status:'missing',items:[]};
   load(p,ctx,options);const loaded=cache.get(keyFor(p,ctx));
   if(loaded&&loaded.status!=='ready'&&!(loaded.status==='loading'&&loaded.retained))return {status:loaded.status,items:[],error:loaded.error};
   try{
    const items=p.items(ctx,loaded?.data,options);if(!Array.isArray(items))throw new TypeError('Provider items must be an array.');
    const keys=new Set();
    for(const item of items){if(typeof item.key!=='string'||!item.key||keys.has(item.key)||typeof item.title!=='string'||!item.data||typeof item.data!=='object')throw new TypeError('Provider items need unique stable keys, titles and data.');keys.add(item.key);}
    return {status:'ready',items,data:loaded?.data};
   }catch(error){return {status:'error',items:[],error};}
  },
  async retry(id){
   const failed=[...cache.values()].filter(value=>(!id||value.provider===id)&&value.status==='error');
   if(!failed.length){invalidate(id);return;}
   for(const value of failed){const request=value.execute(true);onChange();await request;}
  },invalidate,
  retainSlots(slots){for(const [key,value] of cache)if(value.slot!==null&&!slots.has(value.slot)){value.controller.abort();cache.delete(key);}},
  close(){closed=true;cache.forEach(v=>v.controller.abort());unsubscribe();cache.clear();}
 };
}
export const fieldLabel=key=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,s=>s.toUpperCase());
// Preserve provider labels and formatters while discovering new fields.
// Identifiers stay available in their own group.
export function providerFields(provider,items){
 const fields=new Map();
 for(const field of provider.fields??[]){
  const value=typeof field==='string'?{key:field,label:fieldLabel(field)}:field;
  fields.set(value.key,{technical:/(^id$|Id$|^revision$|^formatVersion$)/.test(value.key),...provider.fieldMetadata?.[value.key],...value,label:value.label??provider.fieldMetadata?.[value.key]?.label??fieldLabel(value.key)});
 }
 for(const item of items)for(const key of Object.keys(item.data))if(!fields.has(key))fields.set(key,{key,label:fieldLabel(key),technical:/(^id$|Id$|^revision$|^formatVersion$)/.test(key),...provider.fieldMetadata?.[key]});
 return [...fields.values()];
}
export function displayValue(value,esc){
 if(value?.type==='doc')return '<span class="desk-value">'+esc(proseText(value))+'</span>';
 if(value===null||value===undefined||value==='')return '<span class="muted">—</span>';
 if(Array.isArray(value))return value.length?'<ul class="desk-values">'+value.map(v=>'<li>'+displayValue(v,esc)+'</li>').join('')+'</ul>':'<span class="muted">None</span>';
 if(typeof value==='object')return '<dl class="desk-fields">'+Object.entries(value).map(([k,v])=>'<div><dt>'+esc(fieldLabel(k))+'</dt><dd>'+displayValue(v,esc)+'</dd></div>').join('')+'</dl>';
 return '<span class="desk-value">'+esc(typeof value==='boolean'?(value?'Yes':'No'):String(value))+'</span>';
}
