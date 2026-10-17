import {websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {websiteRecordPages,WEBSITE_PAGE_LIMIT} from './website-page-query.js';
import {websitePageWindow} from './website-page-targets.js';

const text=(key,values)=>t('websitePages',key,values),limit=WEBSITE_PAGE_LIMIT;
// Page discovery owns only the current result window. It never adopts a
// workspace snapshot or reads originals. Selection callbacks own draft changes.
export function websitePagePicker({state,api,esc,field,showDialog,onChoose,pageBook=()=>state.book,recordPages=options=>websiteRecordPages({state,api,...options})}){
 let session=null,controller=null,timer=null,generation=0;
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,state.etag,state.book?.website.researchSources]);
 const valid=s=>s&&s===session&&s.identity===identity()&&state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&s.root.isConnected&&s.dialog.open;
 const button=(key,extra='')=>`<button type="button" class="button" data-page-picker="${key}" ${extra}>${esc(text(key))}</button>`;
 function cancel(){controller?.abort();controller=null;clearTimeout(timer);timer=null;generation++;}
 function stop(){cancel();const s=session;session=null;s?.unbind();}
 const restoreFocus=s=>(document.querySelector(s?.returnFocus??'#website-preview-page')??document.querySelector('[data-region-choice]')??document.querySelector('#website-preview-page'))?.focus({preventScroll:true});
 function close(){const s=session;stop();if(s?.dialog.open)s.dialog.close();restoreFocus(s);}
 function sync(){if(session&&!valid(session))close();}
 function paint(){
  const s=session;if(!valid(s))return;
  const result=s.result,host=s.root.querySelector('[data-page-results]');host.setAttribute('aria-busy',String(s.loading));
  host.innerHTML=`${s.error?`<p role="alert">${esc(s.error)}</p>${button('retry')}`:''}${s.selectionError?`<p role="alert">${esc(s.selectionError)}</p>`:''}${s.loading?`<p role="status">${esc(text('loading'))}</p>`:result?`
   <p role="status" tabindex="-1" data-page-range>${esc(result.total?text('range',{first:result.offset+1,last:result.offset+result.items.length,total:result.total}):result.items.length?text('pageResults',{count:result.items.length}):text('empty'))}</p>
   ${result.changed?`<p>${esc(text('changed'))}</p>`:''}
   <ul class="website-page-results">${result.items.map(item=>{const label=`<span>${esc(item.target==='home'?text('home'):item.title)}</span>${item.context?`<small>${esc(item.context)}</small>`:''}`;return `<li>${s.selection?`<label class="website-page-assignment"><input type="checkbox" data-page-selection="${esc(item.path)}" ${s.selection.has(item)?'checked':''}><span>${label}</span></label>`:`<button type="button" class="button" data-page-path="${esc(item.path)}">${label}</button>`}</li>`;}).join('')}</ul>
   <div class="inline-actions">${button('previous',result.previousCursor===null?'disabled':'')}${button('next',result.nextCursor===null?'disabled':'')}</div>`:''}`;
 }
 async function load(cursor=null,{focus=false}={}){
  cancel();const s=session;if(!valid(s))return;
  const request=generation;controller=new AbortController();const signal=controller.signal;s.loading=true;s.error='';s.selectionError='';s.result=null;paint();
  try{
   let result;
   if(s.kind==='entry')result=await recordPages({search:s.search,cursor,signal});
   else result=websitePageWindow(pageBook(),{kind:s.kind,search:s.search,offset:cursor??0,limit});
   if(!valid(s)||request!==generation)return;s.result=result;
  }catch(error){if(!valid(s)||request!==generation||signal.aborted)return;s.error=error.message??text('failed');}
  finally{if(valid(s)&&request===generation){s.loading=false;controller=null;paint();if(focus)(s.root.querySelector('[data-page-path],[data-page-selection]')??s.root.querySelector('[data-page-range]')??s.root.querySelector('[data-page-picker="retry"]'))?.focus();}}
 }
 function open(currentTarget,{choose=onChoose,selection=null,title=text('title'),help='',returnFocus='#website-preview-page'}={}){
  stop();const candidate=currentTarget?.split(':')[0],kind=['project','notebook','entry'].includes(candidate)?candidate:'site';
  showDialog(`<h2 id="dialog-title">${esc(title)}</h2><div data-website-page-picker>${help?`<p>${esc(help)}</p>`:''}
   <div class="grid two">${field(esc(text('kind')),`<select id="website-page-kind">${['site','project','notebook','entry'].map(value=>`<option value="${value}" ${value===kind?'selected':''}>${esc(text(value))}</option>`).join('')}</select>`)}
   ${field(esc(text('search')),`<input id="website-page-search" type="search" maxlength="512" placeholder="${esc(text('placeholder'))}">`)}</div>
   <div data-page-results aria-busy="false"></div><div class="dialog-actions">${button(selection?'done':'cancel')}</div></div>`);
  const root=document.querySelector('[data-website-page-picker]'),dialog=root.closest('dialog');
  session={root,dialog,kind,search:'',identity:identity(),result:null,loading:false,error:'',selectionError:'',choose,selection,returnFocus};
  const click=event=>{
   const control=event.target.closest('[data-page-picker],[data-page-path]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();
   const s=session;if(!valid(s))return;
   if(['cancel','done'].includes(control.dataset.pagePicker)){close();return;}
   if(s.loading)return;
   if(control.dataset.pagePath){const item=s.result?.items.find(item=>item.path===control.dataset.pagePath);if(item){close();s.choose(item);restoreFocus(s);}return;}
   const key=control.dataset.pagePicker,cursor=key==='next'?s.result?.nextCursor:key==='previous'?s.result?.previousCursor:null;
   if(cursor!==undefined)void load(cursor,{focus:true});
  };
  const input=event=>{
   if(!valid(session))return;
   if(event.target.hasAttribute('data-page-selection')){
    event.stopPropagation();if(event.type!=='change'||session.loading)return;
    const s=session,item=s.result?.items.find(item=>item.path===event.target.dataset.pageSelection);if(!item||!s.selection)return;
    try{s.selectionError='';s.selection.toggle(item,event.target.checked);}catch(error){s.selectionError=error.message??text('failed');}
    if(valid(s)){paint();s.root.querySelector('[data-page-selection="'+item.path+'"]')?.focus({preventScroll:true});}return;
   }
   if(event.target.id==='website-page-search'&&event.type==='input'){
    event.stopPropagation();cancel();session.search=event.target.value;session.loading=true;session.result=null;session.error='';paint();timer=setTimeout(()=>void load(),180);
   }else if(event.target.id==='website-page-kind'&&event.type==='change'){
    event.stopPropagation();session.kind=event.target.value;void load();
   }
  };
  const keydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Enter'&&event.target.id==='website-page-search')event.preventDefault();};
  const dismiss=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
  dialog.addEventListener('cancel',dismiss,true);
  // Native close events are queued. A previous close must not cancel a
  // picker reopened on the same shared dialog before that event is delivered.
  const closed=()=>{if(!dialog.open&&session?.root===root)stop();};
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',input);root.addEventListener('keydown',keydown);dialog.addEventListener('close',closed);
  session.unbind=()=>{dialog.removeEventListener('cancel',dismiss,true);root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',input);root.removeEventListener('keydown',keydown);dialog.removeEventListener('close',closed);};
  void load();root.querySelector('#website-page-search').focus();
 }
 return {open,sync,close};
}
