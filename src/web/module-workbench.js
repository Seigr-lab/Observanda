import {researchContext} from './project-context.js';
import {moduleOwnerApi} from './modules/owner-api.js';
import {projectToolScope} from './project-tools.js';
import {parseScope,normalizeScopePath} from './modules/scope.js';
import {FEATURE_MODULES,enabledModule} from './feature-modules.js';

// The shell dispatches generic module routes and editing commands. Feature UI
// implementations own their screens; adding one does not add an app switch case.
export function moduleWorkbench(services){
 const {state,esc,render}=services,instances=new Map();let scope=null,opening=0,visit=0,selected=null;
 const descriptor=id=>FEATURE_MODULES.find(m=>m.id===id);
 function reconcile(){
  const current=researchContext(state),view=selection();
  if(view!==selected){selected=view;visit++;}
  for(const [id,entry] of starting)if(current!==entry.context||!enabledModule(state.dashboardSettings,id))entry.valid=false;
  for(const [id,instance] of instances)if(current!==scope||!enabledModule(state.dashboardSettings,id)){instance.dispose?.();instances.delete(id);}
  scope=current;
 }
 const starting=new Map();
 async function ready(id){
  reconcile();const module=descriptor(id);
  if(!module||!enabledModule(state.dashboardSettings,id)||!module.createUI)return null;
  if(module.locationTool&&!projectToolScope(state.book,parseScope(state.modulePath).projectId,id))return null;
  const context=scope,waiting=starting.get(id);
  if(waiting?.valid&&waiting.context===context)return waiting.operation;
  if(instances.has(id)){
   const instance=instances.get(id);
   try{await instance.activate?.();reconcile();return context===scope&&instances.get(id)===instance?instance:null;}
   catch(error){reconcile();if(context!==scope||instances.get(id)!==instance)return null;throw error;}
  }
  // Each initializer has a lifetime, even when navigation returns to the same
  // project or a module is disabled and then enabled again before it finishes.
  const entry={context,valid:true},current=()=>entry.valid&&context===researchContext(state)&&enabledModule(state.dashboardSettings,id);
  entry.operation=(async()=>{
   try{
    const value=await module.createUI({...services,api:moduleOwnerApi(services,id)});reconcile();
    if(!current()){value.dispose?.();return null;}
    instances.set(id,value);return value;
   }catch(error){reconcile();if(!current())return null;throw error;}
  })();
  starting.set(id,entry);
  try{return await entry.operation;}finally{if(starting.get(id)===entry)starting.delete(id);}
 }
 const active=()=>instances.get(state.moduleId);
 const selection=()=>JSON.stringify([researchContext(state),state.page,state.moduleId,state.modulePath]);
 const available=()=>{const module=descriptor(state.moduleId);return module&&enabledModule(state.dashboardSettings,module.id)&&(!module.locationTool||projectToolScope(state.book,parseScope(state.modulePath).projectId,module.id));};
 return {
  ready,
  async captureReturn(){
   reconcile();if(state.page!=='module')return null;
   const instance=active(),view=selection(),workspaceId=state.book.id,moduleId=state.moduleId,modulePath=state.modulePath;
   const token=await instance?.captureReturn?.();
   if(view!==selection()||instance!==active())throw new DOMException('Module owner changed','AbortError');
   return token?{workspaceId,moduleId,modulePath,...token}:null;
  },
  async restoreReturn(token,{current=()=>true}={}){
   if(!token)return false;reconcile();
   if(token.workspaceId!==state.book.id||token.moduleId!==state.moduleId||token.modulePath!==state.modulePath||state.page!=='module')throw new DOMException('Module owner changed','AbortError');
   if(!current())throw new DOMException('Module return changed','AbortError');
   return await active()?.restoreReturn?.(token,{current})??false;
  },
  async refreshVisible(){if(state.page==='module'&&available()&&!active()?.isDirty?.())await active()?.activate?.({background:true});},
  supportsOutline:id=>descriptor(id)?.metadataOnly===true,
  view(){
   const module=descriptor(state.moduleId);
   if(!module||!enabledModule(state.dashboardSettings,state.moduleId))return '<section class="panel"><h1>'+esc(module?.label??'Module unavailable')+'</h1><p>Enable this module in Preferences. Its data and settings are retained.</p><button class="button" data-action="dashboard-settings">Manage modules</button></section>';
   if(!available())return '<section class="panel"><h1>'+esc(module.locationTool.label)+'</h1><p>This tool is not enabled for this project. Choose its projects in Preferences.</p><button class="button" data-action="dashboard-settings">Manage modules</button></section>';
   return active()?.view(state.modulePath??'')??'<p>This module has no available workspace screen.</p>';
  },
  bind(){reconcile();for(const [id,instance] of instances)if(state.page!=='module'||state.moduleId!==id)instance.deactivate?.();if(state.page==='module'&&available())active()?.bind?.();},
  async action(button){
   const {action,command}=button.dataset,moduleId=button.dataset.moduleId??FEATURE_MODULES.find(m=>m.aliases?.includes(action))?.id;
   if(action==='module-open'||moduleId&&FEATURE_MODULES.find(m=>m.id===moduleId)?.aliases?.includes(action)){
    const path=button.dataset.modulePath??'',location=descriptor(moduleId)?.locationTool;
    state.moduleId=moduleId;state.modulePath=location?normalizeScopePath(path,location.path):path;reconcile();const request=++opening,started=visit;let editor;
    try{editor=await ready(moduleId);}catch(error){reconcile();if(request!==opening||started!==visit)return true;throw error;}
    reconcile();if(request!==opening||started!==visit)return true;
    state.page='module';if(button.dataset.createType&&editor?.create)await editor.create(button.dataset.createType,button.dataset.recordId?{recordId:button.dataset.recordId}:{});else render();return true;
   }
   reconcile();const instance=active(),started=visit;
   try{if(state.page==='module'&&available()&&await instance?.referenceAction?.(button))return true;}
   catch(error){reconcile();if(started!==visit||instance!==active())return true;throw error;}
   reconcile();if(started!==visit||instance!==active())return true;
   if(action!=='module-command'||state.page!=='module')return false;
   if(moduleId&&moduleId!==state.moduleId)return false;
   if(available())await instance?.action?.(command,button);return true;
  },
  input(element){return state.page==='module'&&available()&&active()?.input?.(element)||false;},
  async submit(form,data){if(state.page!=='module'||!form.hasAttribute('data-module-form'))return false;if(available())await active()?.submit?.(form,data);return true;},
  async flushAutosave(){for(const instance of instances.values())await instance.flushAutosave?.();},
  needsNavigationGuard:()=>[...instances.values()].some(m=>m.needsNavigationGuard?.()??m.isDirty?.()),
  isDirty:()=>[...instances.values()].some(m=>m.isDirty?.()),
  async save(){for(const m of instances.values())if(m.isDirty?.())await m.save();},
  async discard(){for(const m of instances.values())if(m.isDirty?.())await m.discard();}
 };
}
