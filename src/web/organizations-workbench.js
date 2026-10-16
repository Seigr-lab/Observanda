import {organizationsUI} from './organizations-ui.js';
import {sharingUI} from './sharing-ui.js';
import {onlineUI} from './online-ui.js';

// Each workflow owns its forms, state and requests. The module shell only
// composes their lifecycle; membership and content grants remain separate.
export async function organizationsWorkbench(services){
 const online=await onlineUI(services),sharing=await sharingUI({...services,onUpdated:()=>online.activate()}),membership=await organizationsUI({...services,onUpdated:async()=>{await sharing.activate();await online.activate();}}),owners=[sharing,membership,online];
 return {
  view:()=>membership.view()+online.view()+sharing.view(),
  bind:()=>online.bind(),
  action:async(command,node)=>{for(const owner of owners)await owner.action(command,node);},
  input:element=>owners.some(owner=>owner.input(element)),
  submit:async(form,data)=>{for(const owner of owners)await owner.submit(form,data);},
  isDirty:()=>owners.some(owner=>owner.isDirty()),
  activate:async()=>{for(const owner of owners)await owner.activate();},
  deactivate:()=>owners.forEach(owner=>owner.deactivate()),
  dispose:()=>owners.forEach(owner=>owner.dispose()),
  discard:async()=>{for(const owner of owners)await owner.discard();},
  save:async()=>{for(const owner of owners)await owner.save();}
 };
}
