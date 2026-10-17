import {t} from './i18n/index.js';
import {customFieldLabel} from './custom-field-presentation.js';
import {profileById} from './laboratory/catalog.js';
const text=(key,args)=>t('configurationEditor',key,args),tr=key=>t('sharing',key),limit=20;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const empty=()=>({rows:[],total:0,offset:0,next:null});

// Each mounted version owns its requests and selected windows. Nothing here edits a review.
export function sharingConfigurationUI({load,esc,current=()=>true}){
 let generation=0,panels=[];
 function stop(){generation++;for(const panel of panels)panel.stop();panels=[];}
 function mount(root,reviewId){
  stop();const mounted=generation;
  for(const node of root.querySelectorAll('[data-sharing-configuration]')){
   const identity={reviewId,notebookId:node.dataset.notebookId,version:node.dataset.version};
   const dialog=node.closest('dialog');let active=true,header=null,section=null,field=null;
   const slots=Object.fromEntries(['open','profiles','sections','fields','choices'].map(name=>[name,{epoch:0,pending:false,error:false,retry:null,controller:null,result:null}]));
   const alive=()=>active&&mounted===generation&&current()&&node.isConnected&&(!dialog||dialog.open);
   function reset(name){const slot=slots[name];slot.controller?.abort();slot.epoch++;Object.assign(slot,{controller:null,pending:false,error:false,retry:null,result:null});}
   const button=(label,action,attrs='')=>'<button type="button" class="button" data-sharing-config-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
   function state(name){const slot=slots[name];return (slot.pending?'<p role="status">'+esc(text('loading'))+'</p>':'')+(slot.error?'<p role="alert">'+esc(tr('configurationFailed'))+'</p>'+button(text('retry'),'retry','data-collection="'+name+'"'):'');}
   function paging(name,result){return '<div class="module-actions">'+button(text('previous'),'page','data-collection="'+name+'" data-offset="'+Math.max(0,result.offset-limit)+'" '+(result.offset===0?'disabled':''))+'<span>'+esc(text('range',{first:result.rows.length?result.offset+1:0,last:result.offset+result.rows.length,total:result.total}))+'</span>'+button(text('next'),'page','data-collection="'+name+'" data-offset="'+(result.next??0)+'" '+(result.next===null?'disabled':''))+'</div>';}
   function details(value){return '<p>'+esc(customFieldLabel(value))+' - '+esc(value.type)+(value.required?' - '+esc(tr('required')):'')+'</p>';}
   function draw(name){
    if(!alive())return;
    if(name==='open'){
     if(!header){node.innerHTML=state('open')+(!slots.open.pending&&!slots.open.error?'<p>'+esc(text('empty'))+'</p>':'');return;}
     node.innerHTML=['profiles','sections','fields','choices'].map(key=>'<section data-sharing-config-region="'+key+'"></section>').join('');
     for(const key of ['profiles','sections','fields','choices'])draw(key);return;
    }
    const region=node.querySelector('[data-sharing-config-region="'+name+'"]');if(!region)return;
    const slot=slots[name],result=slot.result;
    let prefix='<h5>'+esc(text(name))+(result?' ('+result.total+')':'')+'</h5>';
    if(name==='fields')prefix+=section?'<h6>'+esc(section.value.label)+'</h6>'+(section.value.description?'<p>'+esc(section.value.description)+'</p>':''):'<p>'+esc(tr('configurationChooseType'))+'</p>';
    if(name==='choices')prefix+=field?details(field.value):'<p>'+esc(tr('configurationChooseField'))+'</p>';
    let rows='';
    if(result){
     rows='<ul>'+result.rows.map(row=>{
      if(name==='choices')return '<li>'+esc(row.value)+'</li>';
      if(name==='profiles')return '<li>'+esc(profileById(row.value.id)?.label??row.value.id)+' - '+esc(row.value.version)+' - '+esc(tr(row.value.enabled?'typeEnabled':'typeDisabled'))+'</li>';
      const value=row.value,label=name==='sections'?value.label:customFieldLabel(value);
      return '<li>'+button(label,name==='sections'?'section':'field','data-key="'+esc(row.key)+'"')+' - '+esc(name==='sections'?tr(value.enabled?'typeEnabled':'typeDisabled'):value.type)+(value.required?' - '+esc(tr('required')):'')+'</li>';
     }).join('')+'</ul>'+(result.rows.length?'':'<p>'+esc(text('empty'))+'</p>')+paging(name,result);
    }
    region.innerHTML=prefix+state(name)+rows;
   }
   async function run(name,operation){
    const slot=slots[name];slot.controller?.abort();const epoch=++slot.epoch,controller=new AbortController();Object.assign(slot,{controller,pending:true,error:false,retry:()=>run(name,operation)});draw(name);
    const valid=()=>alive()&&slot.epoch===epoch&&!controller.signal.aborted;
    const request=async data=>{const result=await load({...identity,...data},{signal:controller.signal});if(!valid())throw new DOMException('Obsolete configuration read','AbortError');return result;};
    try{const adopt=await operation(request);if(valid()){adopt();slot.retry=null;}}
    catch(error){if(valid()&&error.name!=='AbortError')slot.error=true;}
    finally{if(valid()){slot.pending=false;slot.controller=null;draw(name);}}
   }
   function validWindow(result){
    if(!result||!Array.isArray(result.rows)||result.rows.length>limit||!count(result.total)||!count(result.offset)||result.offset+result.rows.length>result.total||!(result.next===null||count(result.next)&&result.next>result.offset))throw Error(text('invalid'));
    for(const row of result.rows)if(!row||typeof row.key!=='string'||!count(row.position)||!(typeof row.value==='string'||row.value&&typeof row.value==='object'))throw Error(text('invalid'));
    return result;
   }
   const windowRead=(request,collection,offset=0,selection={})=>request({operation:'window',collection,offset,limit,...selection}).then(validWindow);
   async function itemRead(request,collection,key,selection={}){const result=await request({operation:'item',collection,key,...selection});if(!result?.item||result.item.key!==key||!result.item.value||typeof result.item.value!=='object')throw Error(text('invalid'));return result.item;}
   function page(name,offset){
    const selection=name==='fields'?section?{sectionId:section.key}:null:name==='choices'?section&&field?{sectionId:section.key,fieldKey:field.key}:null:{};
    if(!selection)return;
    return run(name,async request=>{const result=await windowRead(request,name,offset,selection);return()=>{slots[name].result=result;};});
   }
   function open(){return run('open',async request=>{
    const result=await request({operation:'open'});if(!result||result.header!==null&&(!result.header?.counts||!['profiles','sections','fields','choices'].every(key=>count(result.header.counts[key]))))throw Error(text('invalid'));
    return()=>{header=result.header;draw('open');if(header){void page('profiles',0);void page('sections',0);}};
   });}
   function selectSection(key){
    reset('fields');reset('choices');section=field=null;draw('choices');
    return run('fields',async request=>{const selected=await itemRead(request,'sections',key),result=await windowRead(request,'fields',0,{sectionId:key});return()=>{section=selected;slots.fields.result=result;};});
   }
   function selectField(key){
    if(!section)return;const sectionId=section.key;reset('choices');field=null;
    return run('choices',async request=>{const selected=await itemRead(request,'fields',key,{sectionId}),result=selected.value.type==='select'?await windowRead(request,'choices',0,{sectionId,fieldKey:key}):empty();return()=>{field=selected;slots.choices.result=result;};});
   }
   const click=event=>{
    const control=event.target.closest('[data-sharing-config-action]');if(!control||!node.contains(control))return;event.preventDefault();event.stopPropagation();
    if(!alive()||control.disabled)return;const {sharingConfigAction:action,collection,key,offset}=control.dataset;
    if(action==='open')void open();
    if(action==='page')void page(collection,Number(offset));
    if(action==='section')void selectSection(key);
    if(action==='field')void selectField(key);
    if(action==='retry')void slots[collection]?.retry?.();
   };
   node.addEventListener('click',click);panels.push({stop(){active=false;for(const key of Object.keys(slots))reset(key);node.removeEventListener('click',click);}});
  }
 }
 return {mount,stop};
}
