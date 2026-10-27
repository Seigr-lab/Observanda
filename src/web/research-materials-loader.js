import {researchMaterialsLaunch} from './research-materials-launch.js';
import {researchOwner} from './project-context.js';
import {t} from './i18n/index.js';

// Reading a record needs only its evidence entry point. Load the analysis,
// acquisition and retained-data editors when a user actually opens them.
export function researchMaterialsUI(options,{load=()=>import('./research-materials-ui.js')}={}){
 const {state}=options,record=options.getRecord??(()=>state.book?.entries.find(entry=>entry.id===state.selected));
 let instance=null,pending=null;
 const context=()=>JSON.stringify([state.storage?.contextId,state.page,state.selected,researchOwner(state),record()?.id]);
 const ready=()=>instance?Promise.resolve(instance):pending??=(async()=>{try{const module=await load();return instance=module.researchMaterialsUI(options);}finally{pending=null;}})();
 const invoke=async(method,args)=>{const before=context(),ui=await ready();if(before!==context())throw Error(t('figureProvenance','changed'));return ui[method](...args);};
 return {
  view:(subject=record(),settings={})=>instance?instance.view(subject,settings):researchMaterialsLaunch(subject,settings),
  action:control=>control.dataset.action?.startsWith('material-')?invoke('action',[control]):Promise.resolve(false),
  openRevision:(...args)=>invoke('openRevision',args),openReference:(...args)=>invoke('openReference',args),pinFigureSources:(...args)=>invoke('pinFigureSources',args),
  isReadingReference:()=>instance?.isReadingReference()??false,isBusy:()=>Boolean(pending)||Boolean(instance?.isBusy())
 };
}
