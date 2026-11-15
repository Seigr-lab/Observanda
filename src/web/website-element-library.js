import {uiTheme} from './ui-theme-values.js';
// The elements an author can add to a page, shown as cards with a picture and a
// plain description, grouped by purpose and searchable. A card is clicked to add
// the element after the selected part of the page, or dragged to the exact spot.
const dragType='application/x-observanda-element';

const icon=paths=>'<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
const icons={
 heading:icon('<path d="M5 5v14M14 5v14M5 12h9"/><path d="M18 9l2-1v11"/>'),
 paragraph:icon('<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>'),
 quote:icon('<path d="M7 8c-2 1-3 3-3 6h4v-4H6M17 8c-2 1-3 3-3 6h4v-4h-2"/>'),
 details:icon('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M16 6l1.5 1.5L19 6"/><path d="M5 13h14M5 17h10"/>'),
 table:icon('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M3 15h18M9 5v14M15 5v14"/>'),
 equationEdit:icon('<path d="M4 7h7M7.5 4v6M4 16h7M13 13l6 6M19 13l-6 6"/>'),
 section:icon('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M6 8h12M6 12h8"/>'),
 columns:icon('<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>'),
 divider:icon('<path d="M3 12h18"/><path d="M6 7h12M6 17h12" opacity=".4"/>'),
 image:icon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>'),
 gallery:icon('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
 video:icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'),
 actionLink:icon('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/>'),
 download:icon('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>'),
 feed:icon('<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>')
};
export const elementGroups=[
 ['text',['heading','paragraph','quote','details','table','equationEdit']],
 ['layout',['section','columns','divider']],
 ['media',['image','gallery','video']],
 ['actions',['actionLink','download']],
 ['labBook',['feed']]
];

export function websiteElementLibrary({t,esc}){
 let query='';
 const text=key=>t('element_'+key),describe=key=>t('element_'+key+'Text');
 const card=key=>'<button type="button" class="element-card" data-action="website-files-add-block" data-block="'+key+'" draggable="true" data-element-search="'+esc((text(key)+' '+describe(key)).toLocaleLowerCase())+'"><span class="element-card-icon">'+icons[key]+'</span><span class="element-card-text"><strong>'+esc(text(key))+'</strong><small>'+esc(describe(key))+'</small></span></button>';
 function view(){
  return '<section class="panel element-library" aria-label="'+esc(t('elementLibrary'))+'"><h2>'+esc(t('elementLibrary'))+'</h2><p class="hint">'+esc(t('elementLibraryHelp'))+'</p>'+
   '<label class="element-search">'+esc(t('elementSearch'))+'<input type="search" data-element-search-input value="'+esc(query)+'" autocomplete="off"></label>'+
   elementGroups.map(([group,keys])=>'<section class="element-group" data-element-group><h3>'+esc(t('elementGroup_'+group))+'</h3><div class="element-grid">'+keys.map(card).join('')+'</div></section>').join('')+
   '<p class="hint" data-element-none hidden>'+esc(t('elementNone'))+'</p></section>';
 }
 function filter(root){
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);let shown=0;
  for(const group of root.querySelectorAll('[data-element-group]')){
   let visible=0;for(const node of group.querySelectorAll('[data-element-search]')){const match=words.every(word=>node.dataset.elementSearch.includes(word));node.hidden=!match;if(match)visible++;}
   group.hidden=!visible;shown+=visible;
  }
  const none=root.querySelector('[data-element-none]');if(none)none.hidden=shown>0;
 }
 function bind(root){
  const host=root.querySelector('.element-library');if(!host)return;
  const input=host.querySelector('[data-element-search-input]');
  input.oninput=()=>{query=input.value;filter(host);};filter(host);
  host.ondragstart=e=>{const key=e.target.closest?.('[data-block]')?.dataset.block;if(!key)return;e.dataTransfer.setData(dragType,key);e.dataTransfer.setData('text/plain',text(key));e.dataTransfer.effectAllowed='copy';};
 }
 // Dropping on the page places the element before or after the top-level part
 // under the pointer, with a line showing where it will go.
 function bindCanvas(doc,{main,place}){
  const sheet=doc.createElement('style');sheet.dataset.observandaEditor='';doc.head.append(sheet);
  const top=e=>{const root=main(doc);let node=e.target?.nodeType===1?e.target:e.target?.parentElement;while(node&&node.parentElement!==root)node=node.parentElement;return node&&root.contains(node)?node:null;};
  const side=(node,e)=>e.clientY<node.getBoundingClientRect().top+node.getBoundingClientRect().height/2?'before':'after';
  // The line is drawn by a stylesheet only: the page document itself is never marked.
  const clear=()=>{sheet.textContent='';};
  const selector=node=>(node.parentElement.localName==='main'?'main:not([hidden])':'body')+'>:nth-child('+([...node.parentElement.children].indexOf(node)+1)+')';
  doc.addEventListener('dragover',e=>{
   if(!e.dataTransfer.types.includes(dragType))return;e.preventDefault();e.dataTransfer.dropEffect='copy';clear();
   const node=top(e);if(!node)return;
   sheet.textContent=selector(node)+'{box-shadow:inset 0 '+(side(node,e)==='before'?'3px':'-3px')+' 0 '+uiTheme('accent')+'!important}';
  });
  doc.addEventListener('dragleave',e=>{if(!e.relatedTarget)clear();});
  doc.addEventListener('drop',e=>{
   if(!e.dataTransfer.types.includes(dragType))return;e.preventDefault();
   const key=e.dataTransfer.getData(dragType),node=top(e),where=node?side(node,e):'end';clear();
   if(icons[key])place(key,node,where);
  });
 }
 return {view,bind,bindCanvas,dragType};
}
