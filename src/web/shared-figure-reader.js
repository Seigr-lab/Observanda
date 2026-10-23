import {retainedFigureReader} from './retained-figure-reader.js';
import {t} from './i18n/index.js';
const tr=key=>t('retainedFigureReader',key);

// The surrounding reader captures its exact record/packet selector. Only a
// figure ID from that displayed snapshot enters subsequent read operations.
export function sharedFigureControls(esc){return figure=>'<button type="button" class="button" data-shared-figure="'+esc(figure.id)+'">'+esc(tr('open'))+'</button><section data-shared-figure-view="'+esc(figure.id)+'" hidden></section>';}
export function mountSharedFigures(root,{selector,request,downloadURL}){
 const readers=new Map();let disposed=false;
 const click=event=>{
  const button=event.target.closest('[data-shared-figure]');if(disposed||!button||!root.contains(button))return;
  event.preventDefault();event.stopPropagation();const figureId=button.dataset.sharedFigure,host=button.nextElementSibling;
  if(!host?.hasAttribute('data-shared-figure-view'))return;
  if(!host.hidden){readers.get(host)?.dispose();readers.delete(host);host.hidden=true;button.textContent=tr('open');return;}
  host.hidden=false;button.textContent=tr('close');
  const captured={...structuredClone(selector),figureId},reader=retainedFigureReader({root:host,request:(fields,options)=>request({...captured,...fields},options),downloadURL:(format,revision)=>downloadURL({...captured,expectedRevision:revision,format})});readers.set(host,reader);void reader.ready.catch(()=>{});
 };
 root.addEventListener('click',click);
 return {dispose(){disposed=true;root.removeEventListener('click',click);for(const reader of readers.values())reader.dispose();readers.clear();}};
}
