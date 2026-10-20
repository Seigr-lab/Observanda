import {publicationSourceRevision} from './publication-source-context.js';
import {sameWebsitePin} from './website-pin.js';
import {websiteSnapshot} from './website-context.js';
import {websiteSectionWindow} from './website-section-links.js';
import {websiteLink} from './website-links.js';
import {t} from './i18n/index.js';
const tr=(key,values)=>t('websitePages',key,values);

export function websiteSectionPicker({state,api,esc,showDialog,pagePicker,previewTarget,onChoose,pageBook=()=>state.book,documents,recordSections}){
 let session=null,controller=null,generation=0;
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,state.etag,publicationSourceRevision(state),documents?.enabled()?documents.viewKey():null]);
 const valid=s=>s===session&&s.identity===identity()&&state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&s.root.isConnected&&s.dialog.open;
 function stop(){controller?.abort();controller=null;generation++;const s=session;session=null;s?.unbind();return s;}
 function close(){const s=stop();if(s?.dialog.open)s.dialog.close();document.querySelector(s?.selector??'#website-preview-page')?.focus({preventScroll:true});}
 const button=(key,disabled=false)=>'<button type="button" class="button" data-section-picker="'+key+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 function paint(){const s=session;if(!s||!valid(s))return;const page=s.result,host=s.root.querySelector('[data-section-results]');host.setAttribute('aria-busy',String(s.loading));
  host.innerHTML=s.loading?'<p role="status">'+esc(tr('sectionLoading'))+'</p>':s.error?'<p role="alert">'+esc(s.error)+'</p>'+button('retry'):page?'<p role="status">'+esc(page.total?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):tr('sectionsEmpty'))+'</p><ul class="website-page-results">'+page.items.map((item,i)=>'<li><button type="button" class="button" data-section-destination="'+esc(item.id)+'">'+esc(item.title||tr('sectionNumber',{number:page.offset+i+1}))+'</button></li>').join('')+'</ul><div class="inline-actions">'+button('previous',page.previous===null)+button('next',page.next===null)+'</div>':'';
 }
 async function load(offset=0){controller?.abort();controller=new AbortController();const signal=controller.signal,request=++generation,s=session;if(!s||!valid(s))return;s.loading=true;s.error='';paint();
  try{
   let result;
   if(documents?.enabled()&&s.layout===undefined){
    try{s.layout=(await documents.item('layouts',s.target,{signal,retain:false})).value;}catch(error){if(error.code!=='NOT_FOUND')throw error;s.layout=null;}
    if(!valid(s)||request!==generation)return;
    if(s.layout?.placement==='replace'){s.record=false;const source=s.root.querySelector('[data-section-source]');if(source)source.parentElement.hidden=true;}
   }
   const cached=state.book.entries.find(entry=>'entry:'+entry.id===s.target);
   if(s.record&&s.item.owner)result=await recordSections({item:s.item,offset,signal});
   else if(s.record&&state.storage?.researchStorage==='catalogue'&&!Array.isArray(cached?.sections)){
    result=await api('/api/website/research/sections',{workspaceId:state.book.id,snapshotId:state.etag,websitePin:state.websitePin,recordId:s.target.slice(6),offset},{adopt:false,signal});
    if(result.workspaceId!==state.book.id||result.snapshotId!==state.etag||state.websitePin&&!sameWebsitePin(result.websitePin,state.websitePin))throw Error(tr('invalid'));
   }else {let book=pageBook();if(documents?.enabled()&&s.target.startsWith('page:')){const item=await documents.item('pages',s.target.slice(5),{signal,retain:false});book={...book,pages:[item.value]};}if(documents?.enabled())book={...book,website:{...book.website,layouts:s.layout?[s.layout]:[]}};result=websiteSectionWindow(book,s.target,{record:s.record,offset});}
   if(valid(s)&&request===generation)s.result=result;
  }catch(error){if(valid(s)&&request===generation&&!signal.aborted)s.error=error.message||tr('failed');}
  finally{if(valid(s)&&request===generation){s.loading=false;controller=null;paint();}}
 }
 function sections(item,selector){stop();const hasRecord=item.target.startsWith('entry:')&&(documents?.enabled()||state.book.website.layouts.find(layout=>layout.target===item.target)?.placement!=='replace');
  showDialog('<h2 id="dialog-title">'+esc(tr('sectionTitle',{title:item.title}))+'</h2><div data-website-section-picker>'+ (hasRecord?'<label>'+esc(tr('sectionSource'))+'<select data-section-source><option value="record">'+esc(tr('recordSections'))+'</option><option value="design">'+esc(tr('designSections'))+'</option></select></label>':'')+'<div data-section-results></div><div class="dialog-actions">'+button('cancel')+'</div></div>');
  const root=document.querySelector('[data-website-section-picker]'),dialog=root.closest('dialog'),s=session={root,dialog,selector,item,target:item.target,record:hasRecord,identity:identity(),result:null,loading:false,error:''};
  const click=event=>{const control=event.target.closest('[data-section-picker],[data-section-destination]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();if(!valid(s))return;
   if(control.dataset.sectionPicker==='cancel'){close();return;}if(s.loading)return;
   if(control.dataset.sectionDestination){const item=s.result?.items.find(item=>item.id===control.dataset.sectionDestination);if(item){const href=s.target+'#'+item.id;close();onChoose(selector,href);}return;}
   const offset=control.dataset.sectionPicker==='next'?s.result?.next:control.dataset.sectionPicker==='previous'?s.result?.previous:0;if(offset!==null&&offset!==undefined)void load(offset);
  };
  const input=event=>{if(event.target.hasAttribute('data-section-source')&&valid(s)){event.stopPropagation();s.record=event.target.value==='record';void load();}};
  const cancel=event=>{event.preventDefault();event.stopImmediatePropagation();close();},closed=()=>{if(!dialog.open&&session===s)stop();};
  root.addEventListener('click',click);root.addEventListener('change',input);dialog.addEventListener('cancel',cancel,true);dialog.addEventListener('close',closed);
  s.unbind=()=>{root.removeEventListener('click',click);root.removeEventListener('change',input);dialog.removeEventListener('cancel',cancel,true);dialog.removeEventListener('close',closed);};void load();
 }
 return {sync(){if(session&&!valid(session))close();},open(selector){close();const parsed=websiteLink(document.querySelector(selector)?.value),target=parsed?.target||previewTarget();pagePicker.open(target,{title:tr('chooseSectionPage'),returnFocus:selector,choose:item=>sections(item,selector)});}};
}
