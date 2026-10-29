import {language} from './i18n/index.js';
import {moduleLabel,moduleDescription} from './module-presentation.js';
import {FEATURE_MODULES,enabledModule} from './feature-modules.js';
import {ux} from './experience-ui.js';
export const discoverableTools=()=>FEATURE_MODULES.filter(module=>module.createUI||!module.required&&module.navigation?.length);
export function toolDirectoryView({state,esc,pinned=[]}){
 return '<section class="tool-directory" lang="'+language()+'"><h1>'+esc(ux('tools'))+'</h1><p>'+esc(state.book.title)+'</p><p>'+esc(ux('toolsIntro'))+'</p><p class="muted">'+esc(ux('toolExamples'))+'</p><label class="field">'+esc(ux('searchTools'))+'<input type="search" data-tool-search autocomplete="off" value="'+esc(state.toolQuery??'')+'"></label><p data-tool-search-status role="status"></p><div class="tool-directory-grid">'+discoverableTools().map(module=>{
  const enabled=enabledModule(state.dashboardSettings,module.id),selected=pinned.includes(module.id),label=moduleLabel(module),description=moduleDescription(module);
  return '<article class="tool-directory-card" data-tool-card="'+module.id+'" data-tool-search-text="'+esc((label+' '+description+' '+module.label).toLocaleLowerCase())+'"><h2>'+esc(label)+'</h2><p>'+esc(description)+'</p><small>'+esc(ux(enabled?'enabled':'available'))+'</small><button class="button'+(enabled?'':' primary')+'" data-action="'+(enabled?'tool-launch':'tool-enable')+'" data-module-id="'+module.id+'">'+esc(ux(enabled?'open':'enable'))+'</button>'+(enabled?'<button class="button subtle" data-action="tool-pin" data-module-id="'+module.id+'" aria-pressed="'+selected+'">'+esc(ux(selected?'unpin':'pin'))+'</button>':'')+'</article>';
 }).join('')+'</div></section>';
}
export function filterToolDirectory(input){
 if(!input)return;const query=input.value.trim().toLocaleLowerCase(),cards=[...document.querySelectorAll('[data-tool-card]')];
 for(const card of cards)card.hidden=!query.split(/\s+/u).every(term=>card.dataset.toolSearchText.includes(term));
 document.querySelector('[data-tool-search-status]').textContent=cards.some(card=>!card.hidden)?'':ux('noMatches');
}
