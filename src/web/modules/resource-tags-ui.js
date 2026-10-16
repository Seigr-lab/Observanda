import {t} from '../i18n/index.js';
import {parseResourceTags} from './resource-tags.js';
export function resourceTagsUI(){
 let query='',mode='all';
 const text=key=>t('inventoryData',key);
 return {
  query:type=>type==='resource'?{tags:parseResourceTags(query),tagMode:mode}:{},
  filters(type,c){return type.id==='resource'?`<div class="form-grid">${c.field(c.esc(text('tagFilter')),`<input type="search" data-module-list-input="resource-tags" data-resource-tag-query maxlength="2048" value="${c.esc(query)}">`)}${c.field(c.esc(text('tagMode')),`<select data-module-list-input="resource-tag-mode" data-resource-tag-mode>${c.option('all',text('allTags'),mode)}${c.option('any',text('anyTags'),mode)}</select>`)}</div>`:'';},
  filterInput(el){if(el.hasAttribute('data-resource-tag-query')){query=el.value;return true;}if(el.hasAttribute('data-resource-tag-mode')){mode=el.value;return true;}return false;},
  field(d,c){return c.field(c.esc(text('tags')),`<input data-resource-tags maxlength="2048" value="${c.esc((d.data.tags??[]).join(', '))}" aria-describedby="resource-tags-guidance">`)+`<p class="muted" id="resource-tags-guidance">${c.esc(text('tagHelp'))}</p>`;},
  input(el,c){if(!el.hasAttribute('data-resource-tags'))return false;c.current.data.tags=parseResourceTags(el.value);return true;},
  summary(tags,c){return tags?.length?`<p class="resource-tags" aria-label="${c.esc(text('tags'))}">${tags.map(tag=>`<span class="status-badge">${c.esc(tag)}</span>`).join(' ')}</p>`:'';}
 };
}
