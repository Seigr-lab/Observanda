
import {projectToolSettings} from './project-tool-settings.js';
import {FEATURE_MODULES,enabledModule} from './feature-modules.js';
// Feature owners supply inline settings; this host owns discovery and lifecycle.
export function moduleSettings(services){
 const {esc,notify}=services,instances=new Map();let open=null,loading=null,generation=0;
 const slot=id=>document.querySelector('[data-module-settings-slot="'+id+'"]');
 function draw(id){const node=slot(id);if(node){node.innerHTML=instances.get(id)?.view()??'<p role="status">Loading settings…</p>';instances.get(id)?.bind?.(node);}}
 const configurations=module=>[
  ...(module.locationTool?[{module,id:module.createSettings?module.id+':projects':module.id,label:module.projectSettings?.action??'Choose projects',create:s=>projectToolSettings(s,module)}]:[]),
  ...(module.createSettings?[{module,id:module.id,label:module.settingsLabel??'Settings',create:module.createSettings}]:[])
 ];
 const configuration=id=>FEATURE_MODULES.flatMap(configurations).find(c=>c.id===id);
 function control({module,id,label}){
  const expanded=open===id;
  return `<div class="module-inline-settings"><button type="button" class="button subtle" data-action="module-settings-toggle" data-module-settings-id="${id}" aria-expanded="${expanded}" aria-controls="settings-${id}">${esc(label)} <span class="module-settings-unsaved" data-settings-unsaved="${id}" ${instances.get(id)?.isDirty()?'':'hidden'}>Unsaved</span></button>
  ${expanded?`<section id="settings-${id}" data-module-settings-slot="${id}" aria-label="${esc(module.label)} settings">${instances.get(id)?.view()??'<p role="status">Loading settings…</p>'}</section>`:''}</div>`;
 }
 const view=module=>configurations(module).map(control).join('');
 async function save(){for(const instance of instances.values())if(instance.isDirty())await instance.save();}
 async function action(el){
  const name=el.dataset.action;if(!name?.startsWith('module-settings-'))return false;
  const id=el.dataset.moduleSettingsId??el.closest('[data-module-settings-slot]')?.dataset.moduleSettingsSlot;
  if(name==='module-settings-toggle'){
   if(loading)return true;
   const previous=open;
   try{
    const other=[...instances].find(([key,value])=>key!==id&&value.isDirty());
    if(other){open=other[0];services.render();notify('Save or cancel the open settings before editing another module.');return true;}
    if(open===id){open=null;services.render();return true;}
    const config=configuration(id);
    if(!config||!enabledModule(services.state.dashboardSettings,config.module.id))return true;
    const token=generation;open=id;loading=id;services.render();
    let instance=instances.get(id);
    if(instance)await instance.activate?.();
    else instance=await config.create({...services,draw:()=>draw(id),changed:()=>{const mark=document.querySelector('[data-settings-unsaved="'+id+'"]');if(mark)mark.hidden=!instances.get(id)?.isDirty();services.onChange?.();}});
    if(token!==generation){instance.dispose?.();return true;}
    instances.set(id,instance);draw(id);
   }catch(error){open=previous;services.render();notify(error.message);}
   finally{loading=null;}
  }else if(id){await instances.get(id)?.action(el.dataset.command,el);}
  return true;
 }
 return {view,action,save,
  input(el){const id=el.closest('[data-module-settings-slot]')?.dataset.moduleSettingsSlot;return id?instances.get(id)?.input(el)??false:false;},
  bind({refresh=false}={}){if(open){const id=open,node=slot(id),instance=instances.get(id);if(node)instance?.bind?.(node);
   if(node&&instance&&refresh&&!instance.isDirty())instance.activate?.().then(()=>{if(open===id&&!instance.isDirty())draw(id);}).catch(error=>notify(error.message));
  }},
  hasDirtyWithin(id){return [...instances].some(([key,instance])=>{
   if(!instance.isDirty())return false;
   for(let current=configuration(key)?.module.id;current;current=FEATURE_MODULES.find(m=>m.id===current)?.parentId)if(current===id)return true;
   return false;
  });},
  isDirty:()=>[...instances.values()].some(instance=>instance.isDirty()),
  async discard(){for(const instance of instances.values())await instance.discard();},
  reset(){generation++;open=null;loading=null;for(const instance of instances.values())instance.dispose?.();instances.clear();}
 };
}
