import {bomSourceClient} from './bom-source-client.js';
import {moduleReferencePicker} from './reference-picker.js';
import {addressedBOM,bomRequirements,bomResourceReference,bomResourceKey,localBOMResource} from './bom-model.js';
import {inventoryLocation} from './inventory-model.js';
import {add,negate,compare} from './quantities.js';
import {t,language} from '../i18n/index.js';
const tr=(key,args)=>t('bomStock',key,args);
const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
const key=(reference,place)=>JSON.stringify([bomResourceKey(reference),place]);
export function bomSourcesUI(services,c){
 const {state,esc}=services,current=()=>c.current,active=()=>state.page==='module'&&state.moduleId==='resources'&&current()?.type==='bom';
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,state.modulePath,current()?.id]);
 const selections=()=>active()?JSON.stringify(current().data.lines.map(line=>[line.id,line.resourceId,line.sourceProjectId])):null;
 const client=bomSourceClient({...services,active,identity:()=>identity()+selections()});
 const values=new Map(),failures=new Map(),offsets=new Map();let stamp=null,request=null,loading=false,selecting=null,generation=0;
 const own=line=>localBOMResource(line,state.book.id),foreign=line=>line.resourceId&&!own(line),reference=line=>bomResourceReference(line,state.book.id);
 const selected=line=>values.get(key(reference(line),line.sourceProjectId));
 const requirements=data=>{try{return bomRequirements(data,state.book.id);}catch{return null;}};
 const requirementRow=group=>'<li data-bom-requirement="'+esc(key(bomResourceReference(group,state.book.id),group.projectId))+'"><span data-bom-stock-title></span><span data-bom-stock-need></span><span data-bom-stock-state role="status"></span></li>';
 const picker=moduleReferencePicker({...services,client,current,typeLabel:()=>tr('material'),onChoose:async(item,{draft,stillCurrent})=>{
  const line=selecting;if(!stillCurrent()||current()!==draft||!draft.data.lines.includes(line))return;
  const placement=line.resourceId&&reference(line).workspaceId===item.reference.workspaceId?line.sourceProjectId:null;
  const stock=await client.stock(item.reference,{scopeIds:[placement],unlock:true});
  if(!stillCurrent()||current()!==draft||!draft.data.lines.includes(line))return;
  line.resourceId=item.reference.workspaceId===state.book.id?item.reference.id:{...item.reference};line.sourceProjectId=placement;line.unit=stock.resource.data.unit;if(!line.value)line.value=stock.resource.data.name;
  values.set(key(item.reference,placement),stock);c.change();c.draw();
 }});
 function sync(){
  const next=active()?identity()+selections():null;if(next===stamp)return false;
  request?.abort();request=null;client.cancel();loading=false;generation++;
  const allowed=new Set(active()?current().data.lines.filter(foreign).map(line=>key(reference(line),line.sourceProjectId)):[]);
  for(const value of values.keys())if(!allowed.has(value))values.delete(value);failures.clear();stamp=next;return true;
 }
 function field(line){
  const local=own(line),value=foreign(line)?selected(line):null;
  return '<div class="bom-source-choice">'+(foreign(line)?c.button(value?.resource.data.name??tr(failures.has(key(reference(line),line.sourceProjectId))?'unavailable':'chooseItem'),'bom-source-choose','data-id="'+line.id+'" data-bom-source-title="'+line.id+'"'):c.itemField('bom-'+line.id,t('inventoryData','chooseComponent')))+' '+(!foreign(line)?c.button(tr('other'),'bom-source-choose','data-id="'+line.id+'"'):'')+'<small data-bom-source-owner="'+line.id+'"></small></div>';
 }
 function placementOptions(line,item){
  const selected=item?.selectedPlacements.find(value=>value.id===line.sourceProjectId),places=[...(item?.placements??[])];
  if(selected&&!places.some(value=>value.id===selected.id))places.unshift(selected);
  if(!places.some(value=>value.id===line.sourceProjectId))places.unshift({id:line.sourceProjectId,title:line.sourceProjectId?tr('unchecked'):tr('central')});
  return places.map(value=>c.option(value.id??'',value.title,line.sourceProjectId??'')).join('');
 }
 function placementField(line){
  if(!foreign(line))return null;const item=selected(line),offset=offsets.get(line.id)??0;
  return '<div data-bom-source-placement="'+line.id+'">'+c.field(tr('placement'),'<select data-bom-line="'+line.id+'" data-bom-field="sourceProjectId">'+placementOptions(line,item)+'</select>')+'<div class="inline-actions" data-bom-placement-pages>'+c.button(tr('previous'),'bom-source-previous','data-id="'+line.id+'" '+(!offset?'disabled':''))+c.button(tr('next'),'bom-source-next','data-id="'+line.id+'" '+(!item?.placementNextOffset?'disabled':''))+'</div></div>';
 }
 function preview(data){
  return '<div data-bom-source-preview><p data-bom-quantity-error role="status"></p><ul>'+(requirements(data)??[]).map(requirementRow).join('')+'</ul>'+c.button(tr('retry'),'bom-source-retry')+'</div>';
 }
 function paint(){
  if(!active())return;
  for(const line of current().data.lines.filter(foreign)){
   const item=selected(line),failure=failures.get(key(reference(line),line.sourceProjectId));
   text(document.querySelector('[data-bom-source-title="'+line.id+'"]'),item?.resource.data.name??tr(failure?'unavailable':loading?'loading':'chooseItem'));
   const owner=item?.owner;text(document.querySelector('[data-bom-source-owner="'+line.id+'"]'),owner?[owner.workspaceTitle,owner.projectTitle,owner.notebookTitle].filter(Boolean).join(' / '):'');
   const location=document.querySelector('[data-bom-source-placement="'+line.id+'"]');if(location){const select=location.querySelector('select'),html=placementOptions(line,item),signature=JSON.stringify([item?.placements,item?.selectedPlacements,line.sourceProjectId,language()]);if(select.dataset.signature!==signature){select.innerHTML=html;select.dataset.signature=signature;}const offset=offsets.get(line.id)??0;location.querySelector('[data-bom-placement-pages]').hidden=!offset&&!item?.placementNextOffset;location.querySelector('[data-command="bom-source-previous"]').disabled=loading||!offset;location.querySelector('[data-command="bom-source-next"]').disabled=loading||!item?.placementNextOffset;}
  }
  const root=document.querySelector('[data-bom-source-preview]');if(!root)return;
  const groups=requirements(current().data);text(root.querySelector('[data-bom-quantity-error]'),groups?'':tr('invalidQuantity'));if(!groups)return;
  const list=root.querySelector('ul'),keys=JSON.stringify(groups.map(group=>key(bomResourceReference(group,state.book.id),group.projectId)));if(list.dataset.keys!==keys){list.innerHTML=groups.map(requirementRow).join('');list.dataset.keys=keys;}
  for(const group of groups){
   const ref=bomResourceReference(group,state.book.id),node=[...root.querySelectorAll('[data-bom-requirement]')].find(row=>row.dataset.bomRequirement===key(ref,group.projectId));if(!node)continue;
   const local=localBOMResource(group,state.book.id),item=local?c.inventory.get(local):values.get(key(ref,group.projectId)),resource=local?item:item?.resource,stock=local?item:item?.stock,row=stock?.locations.find(value=>value.projectId===group.projectId),unit=current().data.lines.find(line=>line.resourceId&&key(reference(line),line.sourceProjectId)===key(ref,group.projectId))?.unit??'';
   const location=local?inventoryLocation(state.book,group.projectId):item?.selectedPlacements.find(value=>value.id===group.projectId)?.title;
   text(node.querySelector('[data-bom-stock-title]'),resource?(resource.data.name+(location?' / '+location:'')+': '):'');text(node.querySelector('[data-bom-stock-need]'),tr('need',{quantity:group.quantity,unit})+' / ');
   let status=tr(loading?'loading':'unavailable');if(row){status=tr('available',{quantity:row.available,unit});if(compare(group.quantity,row.available)>0)status+=' / '+tr('short',{quantity:add(group.quantity,negate(row.available)),unit});}
   text(node.querySelector('[data-bom-stock-state]'),status);
  }
  root.querySelector('[data-command="bom-source-retry"]').disabled=loading;
 }
 async function load({unlock=false,force=false}={}){
  sync();if(!active())return;request?.abort();const pending=request=new AbortController(),ticket=generation,signature=stamp;loading=true;paint();
  const buckets=new Map();for(const line of current().data.lines.filter(foreign)){const ref=reference(line),entryKey=key(ref,line.sourceProjectId);if(!force&&values.has(entryKey))continue;const bucket=buckets.get(ref.workspaceId)??{refs:new Map(),places:new Set(),needs:new Set()};bucket.refs.set(bomResourceKey(ref),ref);bucket.places.add(line.sourceProjectId);bucket.needs.add(entryKey);buckets.set(ref.workspaceId,bucket);}
  try{for(const bucket of buckets.values()){const refs=[...bucket.refs.values()],places=[...bucket.places];for(let start=0;start<refs.length;start+=25)for(let offset=0;offset<places.length;offset+=25){const selected=refs.slice(start,start+25),scopeIds=places.slice(offset,offset+25);try{const result=await client.stock(selected,{scopeIds,signal:pending.signal,unlock});if(ticket!==generation||signature!==stamp||pending.signal.aborted)return;for(const item of result.items)for(const place of scopeIds){const target=key(item.reference,place);if(bucket.needs.has(target)){values.set(target,item);failures.delete(target);}}}catch(error){if(error.name==='AbortError')return;if(ticket!==generation||signature!==stamp)return;for(const ref of selected)for(const place of scopeIds){const target=key(ref,place);if(bucket.needs.has(target)){values.delete(target);failures.set(target,error);}}}paint();}}}
  finally{if(request===pending&&ticket===generation){request=null;loading=false;paint();}}
 }
 function bind(){picker.sync();const changed=sync();if(!active()){stop();return;}paint();if(changed&&!request)void load();}
 async function action(name,node){
  if(!name.startsWith('bom-source-'))return false;
  if(name==='bom-source-retry'){await c.inventory.action('inventory-retry',node);await load({unlock:true,force:true});return true;}
  const line=current()?.data.lines.find(value=>value.id===node.dataset.id);if(!line)return true;
  if(name==='bom-source-choose'){selecting=line;picker.open({title:tr('choose'),types:['resource']});return true;}
  if(name==='bom-source-next'||name==='bom-source-previous'){
   const item=selected(line),offset=name==='bom-source-next'?item?.placementNextOffset:Math.max(0,(offsets.get(line.id)??0)-25);if(offset===null||offset===undefined)return true;
   const draft=current(),ref=reference(line),place=line.sourceProjectId;try{const result=await client.stock(ref,{scopeIds:[place],placementOffset:offset,unlock:true});if(current()!==draft||!draft.data.lines.includes(line)||key(reference(line),line.sourceProjectId)!==key(ref,place))return true;values.set(key(ref,place),result);offsets.set(line.id,offset);paint();}catch(error){if(error.name!=='AbortError'){values.delete(key(ref,place));failures.set(key(ref,place),error);paint();}}return true;
  }
  return false;
 }
 function stop(){request?.abort();request=null;client.cancel();picker.stop();stamp=null;selecting=null;loading=false;generation++;values.clear();failures.clear();offsets.clear();}
 async function review(){
  const draft=current(),signature=identity()+selections(),groups=new Map();
  for(const line of draft.data.lines.filter(line=>!line.dnp&&line.resourceId)){const ref=reference(line),bucket=groups.get(ref.workspaceId)??new Map();bucket.set(bomResourceKey(ref),ref);groups.set(ref.workspaceId,bucket);}
  const resources=[];for(const group of groups.values()){const refs=[...group.values()];for(let start=0;start<refs.length;start+=25){const selected=refs.slice(start,start+25),result=await client.stock(selected,{scopeIds:[null],unlock:true});if(current()!==draft||signature!==identity()+selections())throw new DOMException('BOM selection changed','AbortError');for(const item of result.items)resources.push({id:item.reference.workspaceId===state.book.id?item.reference.id:item.reference,revision:item.resource.revision});}}
  return resources;
 }
 return {review,field,placementField,preview,paint,bind,changed:bind,action,stop,handles:data=>addressedBOM(data),get:line=>selected(line),invalidate(){values.clear();stamp=null;},get loading(){return loading;}};
}
