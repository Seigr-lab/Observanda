import {websiteHTML} from './website-html-document.js';
import {confirmAction} from './confirm-action.js';

const windowSize=40;
const normalize=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function suggestedPagePath(title,taken){
 if(!title.trim())return '';
 let base=normalize(title.normalize('NFKC')).replaceAll('ø','o').replaceAll('æ','ae').replaceAll('ß','ss')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'page';
 if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(base))base+='-page';
 let file=base+'.html';
 for(let number=2;taken.has(file);number++)file=base+'-'+number+'.html';
 return file;
}
const ownsMetadata=element=>Boolean(element?.closest('[data-observanda-source],[data-observanda-link]'));
const description=head=>Array.from(head.children).filter(node=>node.localName==='meta'&&node.getAttribute('name')?.toLowerCase()==='description');
const titleElement=head=>Array.from(head.children).find(node=>node.localName==='title');
function properties(doc){
 const title=titleElement(doc.head),descriptions=description(doc.head);
 return {title:title?.textContent??'',description:descriptions[0]?.getAttribute('content')??'',language:doc.documentElement.getAttribute('lang')??'',
  titleManaged:ownsMetadata(title),descriptionManaged:descriptions.some(ownsMetadata)};
}
function validLanguage(language){
 if(!language||/^x(?:-[a-z0-9]{1,8})+$/i.test(language))return true;
 // The HTML lang attribute also accepts registered grandfathered tags that
 // the ICU locale identifier used by Intl does not always recognize.
 if(/^(?:art-lojban|cel-gaulish|en-gb-oed|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|no-(?:bok|nyn)|sgn-(?:be-fr|be-nl|ch-de)|zh-(?:guoyu|hakka|min|min-nan|xiang))$/i.test(language))return true;
 try{return Intl.getCanonicalLocales(language).length===1;}catch{return false;}
}
function applyProperties(doc,original,draft){
 const {head,documentElement}=doc,current=properties(doc);
 if(draft.title!==original.title&&!current.titleManaged){
  const title=titleElement(head)??head.appendChild(doc.createElement('title'));title.textContent=draft.title.trim();
 }
 if(draft.description!==original.description&&!current.descriptionManaged){
  const nodes=description(head),text=draft.description.trim();
  if(text){const first=nodes.shift()??head.appendChild(doc.createElement('meta'));first.setAttribute('name','description');first.setAttribute('content',text);}
  for(const obsolete of nodes)obsolete.remove();
 }
 if(draft.language!==original.language){
  const language=draft.language.trim();if(language)documentElement.setAttribute('lang',language);else documentElement.removeAttribute('lang');
 }
}
export function websitePageRows(pages){
 return pages.map(page=>({...page,query:normalize(page.title+' '+page.path)}));
}
export function websitePageWindow(rows,{search='',state='all',offset=0}={}){
 const words=normalize(search.trim()).split(/\s+/).filter(Boolean);
 const wanted=Math.max(0,offset),selected=[],last=[];let total=0;
 for(const row of rows){
  if(state!=='all'&&(state==='draft')!==Boolean(row.draft)||!words.every(word=>row.query.includes(word)))continue;
  if(total%windowSize===0)last.length=0;
  last.push(row);if(total>=wanted&&selected.length<windowSize)selected.push(row);total++;
 }
 const start=Math.min(wanted,Math.max(0,Math.ceil(total/windowSize)-1)*windowSize);
 return {rows:start===wanted?selected:last,total,start,end:Math.min(start+windowSize,total),previous:Math.max(0,start-windowSize)};
}
export function websiteFilesPages({site,esc,tr,render,openPage,edit,save:saveDocument,request,adopt,changed=()=>{},close}){
 let signature='',pageSignature='',base=null,draft=null,rows=[],search='',state='all',offset=0,touched=false;
 let review=null,delivery=null;
 const key=()=>{const current=site();return current?current.site.id+'/'+current.site.revision+'/'+current.path:'';};
 function reset(){signature=pageSignature='';base=draft=null;rows=[];search='';state='all';offset=0;touched=false;review=delivery=null;}
 function sync(){
  const current=site();if(!current)return;
  const listKey=current.site.id+'/'+current.site.revision;
  if(signature!==listKey){rows=websitePageRows(current.site.pages);signature=listKey;}
  if(pageSignature!==key()&&!touched){
   base=properties(websiteHTML(current.html));draft={...base};pageSignature=key();review=delivery=null;
  }
 }
 function open(){sync();render();}
 const option=page=>'<option value="'+esc(page.path)+'"'+(page.path===site()?.path?' selected':'')+'>'+esc(page.draft?tr('draftPage',{title:page.title}):page.title)+'</option>';
 function options(){
  const current=site();if(!current)return '';
  const pages=current.site.pages.slice(0,windowSize);
  if(!pages.some(page=>page.path===current.path)){const selected=current.site.pages.find(page=>page.path===current.path);if(selected)pages.push(selected);}
  return pages.map(option).join('');
 }
 const button=(key,id,disabled=false)=>'<button type="button" class="button" data-action="website-files-pages-'+id+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 function inclusionView(){
  const page=site().site.pages.find(p=>p.path===site().path);if(!page)return '';
  const status=delivery?'<p role="status">'+esc(tr('pageDelivery_'+delivery.state))+'</p>':'';
  const controls=page.path==='index.html'?'<span>'+esc(tr('pageHomeIncluded'))+'</span>':button(page.draft?'pageReviewInclude':'pageReviewPrivate','review-inclusion',touched);
  if(!review)return '<section class="website-page-inclusion"><h3>'+esc(tr('pageInclusion'))+'</h3><p><strong>'+esc(tr(page.draft?'pagePrivate':'pageIncludeNext'))+'</strong></p>'+status+'<div class="inline-actions">'+controls+button('pageCheckDelivery','delivery')+'</div></section>';
  const items=review.items.map(row=>{
   const origin=row.target?tr(row.shared?'pagePublic':'pagePrivate'):row.shared?tr('pageSharedAsset'):'';
   return '<li><strong>'+esc(tr('pageImpact_'+row.kind))+'</strong><span><code>'+esc(row.name)+'</code>'+(row.target?' → <code>'+esc(row.target)+'</code>':'')+(row.count!==undefined?' · '+esc(String(row.count)):'')+(origin?' · '+esc(origin):'')+'</span></li>';
  }).join('');
  return '<section class="website-page-inclusion" aria-label="'+esc(tr('pageChangeReview'))+'"><h3>'+esc(tr('pageChangeReview'))+'</h3><p>'+esc(tr(page.draft?'pageReviewIncludeHint':'pageReviewPrivateHint'))+'</p><ul>'+items+'</ul><p>'+esc(tr('pageRange',{start:review.offset+1,end:review.offset+review.items.length,total:review.total}))+'</p>'+
   (review.offset||review.next!==null?'<div class="inline-actions">'+button('pageBack','inclusion-back',!review.offset)+button('pageForward','inclusion-next',review.next===null)+'</div>':'')+
   '<div class="inline-actions">'+button(page.draft?'pageConfirmInclude':'pageConfirmPrivate','apply-inclusion',touched)+button('cancel','cancel-inclusion')+'</div></section>';
 }
 function results(){
  const result=websitePageWindow(rows,{search,state,offset});offset=result.start;
  const list=result.rows.map(page=>'<li><button type="button" class="button" data-action="website-files-pages-open" data-saved-page="'+esc(page.path)+'"'+(site().path===page.path?' aria-current="page"':'')+'><strong>'+esc(page.title)+'</strong> <code>'+esc(page.path)+'</code> · '+esc(tr(page.draft?'pagePrivate':'pagePublic'))+'</button></li>').join('');
  return '<p role="status">'+esc(result.total?tr('pageRange',{start:result.start+1,end:result.end,total:result.total}):tr('noPageMatches'))+'</p>'+
   (list?'<ul>'+list+'</ul>':'')+(result.total>windowSize?button('pageBack','back',offset===0)+button('pageForward','forward',result.end>=result.total):'');
 }
 function view(){
  sync();if(!draft)return '';
  const conflict=touched&&pageSignature!==key();
  return '<section class="panel website-file-pages"><h2>'+esc(tr('pagePanel'))+'</h2><label>'+esc(tr('pageSearch'))+'<input type="search" data-pages-search value="'+esc(search)+'"></label>'+
   '<label>'+esc(tr('pageVisibility'))+'<select data-pages-state>'+[['all','allPages'],['public','pagePublic'],['draft','pagePrivate']].map(([value,label])=>'<option value="'+value+'"'+(state===value?' selected':'')+'>'+esc(tr(label))+'</option>').join('')+'</select></label>'+
   '<div data-pages-results>'+results()+'</div><h3>'+esc(tr('pageSettings'))+'</h3><p><code>'+esc(site().path)+'</code></p><button type="button" class="button" data-action="website-files-manage-page">'+esc(tr('lifeManagePage'))+'</button>'+inclusionView()+
   (conflict?'<p role="alert">'+esc(tr('changed'))+'</p>'+button('reopen','reload'):
   '<label>'+esc(tr('pageTitle'))+'<input data-page-setting="title" value="'+esc(draft.title)+'" maxlength="200"'+(base.titleManaged?' readonly':'')+'></label>'+
   '<label>'+esc(tr('pageDescription'))+'<textarea data-page-setting="description"'+(base.descriptionManaged?' readonly':'')+'>'+esc(draft.description)+'</textarea></label>'+
   '<label>'+esc(tr('pageLanguage'))+'<input data-page-setting="language" value="'+esc(draft.language)+'" placeholder="en" autocapitalize="none" spellcheck="false"></label>'+
   (base.titleManaged||base.descriptionManaged?'<p>'+esc(tr('pageManaged'))+'</p>':'')+button('savePageSettings','save',!touched))+
   (!site().site.pages.find(p=>p.path===site().path)?.draft?'<button type="button" class="button" data-action="website-files-design-manage">'+esc(tr('designManage'))+'</button>':'')+button('closePages','close')+'</section>';
 }
 function repaintResults(){const host=document.querySelector('[data-pages-results]');if(host)host.innerHTML=results();}
 function input(el){
  if(el.matches('[data-pages-search]')){search=el.value;offset=0;repaintResults();return true;}
  if(el.matches('[data-pages-state]')){state=el.value;offset=0;repaintResults();return true;}
  const field=el.dataset.pageSetting;if(!['title','description','language'].includes(field))return false;
  if(!draft||pageSignature!==key()||field==='title'&&base.titleManaged||field==='description'&&base.descriptionManaged)return true;
  draft[field]=el.value;touched=['title','description','language'].some(k=>draft[k]!==base[k]);changed();
  const save=document.querySelector('[data-action="website-files-pages-save"]');if(save)save.disabled=!touched;
  return true;
 }
 async function save(){
  if(!touched)return;
  if(pageSignature!==key())throw Error(tr('changed'));
  if(draft.title!==base.title&&!draft.title.trim())throw Error(tr('pageTitleRequired'));
  if(draft.language!==base.language&&!validLanguage(draft.language.trim()))throw Error(tr('pageLanguageInvalid'));
  edit(doc=>applyProperties(doc,base,draft));await saveDocument();
  touched=false;pageSignature='';sync();changed();render();
 }
 async function handle(operation,el){
  if(!operation.startsWith('pages-'))return false;
  const action=operation.slice(6);
  if(action==='cancel-inclusion'){review=null;render();return true;}
  if(['review-inclusion','inclusion-back','inclusion-next','apply-inclusion','delivery'].includes(action)){
   if(touched&&action!=='delivery')return true;
   const current=site(),pin={siteId:current.site.id,expectedRevision:current.site.revision,path:current.path},stamp=key();
   if(action==='delivery'){
    const result=await request('page/delivery',pin);if(key()===stamp){delivery=result;render();}return true;
   }
   const inclusion=current.site.pages.find(p=>p.path===current.path)?.draft?'included':'private';
   if(action==='apply-inclusion'){
    if(!review||review.revision!==pin.expectedRevision||review.path!==pin.path)return true;
    const result=await request('page/apply-inclusion',{...pin,inclusion,reviewId:review.reviewId});
    if(key()===stamp){review=null;adopt(result);sync();delivery={state:'reviewed'};render();}
    return true;
   }
   const offset=action==='inclusion-next'?review.next:action==='inclusion-back'?review.previous:0;
   const result=await request('page/review-inclusion',{...pin,inclusion,offset});
   if(key()===stamp){review={...result,offset};render();}return true;
  }
  if(action==='save'){await save();return true;}
  if(action==='close'||action==='reload'){
   if(touched&&!await confirmAction(tr('discardConfirm'),{action:'discard'}))return true;
   touched=false;pageSignature='';changed();
   if(action==='close')close();else{sync();render();}return true;
  }
  if(action==='open'){
   if(touched){if(!await confirmAction(tr('saveBeforeLeave'),{action:'save'}))return true;await save();}
   await openPage(el.dataset.savedPage);return true;
  }
  if(action==='back'||action==='forward'){offset+=action==='back'?-windowSize:windowSize;repaintResults();return true;}
  return false;
 }
 return {view,open,options,input,handle,save,reset,dirty:()=>touched};
}
