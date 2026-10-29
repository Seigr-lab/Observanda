import {organizationsUI} from './organizations-ui.js';
import {sharingUI} from './sharing-ui.js';
import {onlineUI} from './online-ui.js';
import {ux} from './experience-ui.js';
import {focusElement} from './focus-management.js';

// Each workflow owns its forms, state and requests. The module shell only
// composes their lifecycle; membership and content grants remain separate.
export async function organizationsWorkbench(services){
 const online=await onlineUI(services),sharing=await sharingUI({...services,onUpdated:()=>online.activate()}),membership=await organizationsUI({...services,onUpdated:async()=>{await sharing.activate();await online.activate();}}),owners=[sharing,membership,online];
 return {
  view:()=>'<section class="workflow-guide"><p>'+services.esc(ux('collaborationHelp'))+'</p><nav class="inline-actions">'+[['sharing',ux('shareCopy')],['online',ux('liveAccess')],['membership',ux('membership')]].map(([id,title])=>'<button class="button" data-action="module-command" data-command="exchange-section" data-section="'+id+'">'+services.esc(title)+'</button>').join('')+'</nav></section>'+[['sharing',sharing],['online',online],['membership',membership]].map(([id,owner])=>'<section data-exchange-section="'+id+'" tabindex="-1">'+owner.view()+'</section>').join(''),
  bind:()=>online.bind(),
  action:async(command,node)=>{if(command==='exchange-section'){const section=[...document.querySelectorAll('[data-exchange-section]')].find(item=>item.dataset.exchangeSection===node.dataset.section);if(focusElement(section))section.scrollIntoView({block:'start'});return;}for(const owner of owners)await owner.action(command,node);},
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
