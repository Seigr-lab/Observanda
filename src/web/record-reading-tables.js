import {t} from './i18n/index.js';

// Keep overflow discoverable when the operating system hides scrollbars.
// Observers follow only the currently rendered reading surfaces.
const views=new Map(),owners=new WeakMap();
let observer;
function update(view){
 const entry=views.get(view);if(!entry)return;
 const overflow=view.scrollWidth>view.clientWidth+1;
 entry.hint.hidden=!overflow;
 if(overflow){view.tabIndex=0;if(!view.hasAttribute('role'))view.setAttribute('role','region');if(!view.hasAttribute('aria-label'))view.setAttribute('aria-label',t('recordReading','table'));}
}
export function bindReadingTables(root=document){
 if(typeof ResizeObserver==='undefined')return;
 observer??=new ResizeObserver(entries=>{for(const {target} of entries)update(owners.get(target)??target);});
 for(const [view,entry] of views)if(!view.isConnected){observer.unobserve(view);observer.unobserve(entry.table);views.delete(view);}
 for(const view of root.querySelectorAll(':is(.record-reader,.lab-book-reading-entry) :is(.book-table-scroll,.table-scroll)')){
  const table=view.querySelector('table');if(!table)continue;
  if(!views.has(view)){
   const hint=view.ownerDocument.createElement('p');hint.className='reading-table-hint';hint.textContent=t('recordReading','tableOverflow');hint.hidden=true;view.before(hint);
   views.set(view,{table,hint});owners.set(table,view);observer.observe(view);observer.observe(table);
  }
  update(view);
 }
}
