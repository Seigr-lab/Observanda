import {t} from './i18n/index.js';
import {renderProse} from './prose-model.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
const tr=(key,values)=>t('online',key,values);

// This local library never contacts a host. Drafts remain readable after a
// disconnect, access revocation or application restart.
export function onlineDraftsUI({call,esc,render,button}){
 let page={items:[],next:null},selected=null,generation=0;
 const reference=value=>({connectionId:value.connectionId,recordId:value.recordId,field:value.field,clientId:value.clientId});
 async function load(after=null){const request=++generation,result=await call('drafts',{after});if(request===generation){page=result;selected=null;render();}}
 function view(){return '<section class="online-drafts"><h2>'+esc(tr('draftLibrary'))+'</h2><p>'+esc(tr('draftLibraryHelp'))+'</p>'+button('backConnections','connections')+(!page.items.length?'<p>'+esc(tr('noDrafts'))+'</p>':'<ul>'+page.items.map((d,i)=>'<li><strong>'+esc(d.title||d.recordId)+'</strong><p>'+esc(d.fieldTitle||d.field)+' · '+esc(d.savedAt)+'</p>'+button('inspectDraft','draft-open','data-index="'+i+'"')+'</li>').join('')+'</ul>')+'<div class="module-actions">'+button('firstDrafts','draft-first')+(page.next?button('nextDrafts','draft-next'):'')+'</div>'+(selected?'<section data-online-draft-preview><h3>'+esc(selected.title||selected.recordId)+'</h3><p>'+esc(selected.fieldTitle||selected.field)+' · '+esc(selected.savedAt)+'</p><div class="prose">'+renderProse(selected.document)+'</div><div class="module-actions">'+button('reviewDraft','draft-review')+button('discardDraft','draft-discard')+'</div></section>':'')+'</section>';}
 async function action(op,node){
  if(op==='draft-first')await load();
  if(op==='draft-next'&&page.next)await load(page.next);
  if(op==='draft-open'){const item=page.items[Number(node.dataset.index)];if(!item)return;const request=++generation,result=await call('draft',{...reference(item),readOnly:true});if(request!==generation)return;selected=result.draft;render();if(selected)applyRichTextStyles(document,selected.document);document.querySelector('[data-online-draft-preview]')?.scrollIntoView({block:'nearest'});}
  if(op==='draft-discard'&&selected){await call('draft',{...reference(selected),expectedRevision:selected.revision,document:null});await load();}
 }
 return {load,view,action,selected:()=>selected,clear(){generation++;selected=null;page={items:[],next:null};}};
}
