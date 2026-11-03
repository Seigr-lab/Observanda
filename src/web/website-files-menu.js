import {websitePageRows,websitePageWindow} from './website-files-pages.js';

export function websiteFilesMenu({request,site,esc,tr,render,adopt,close,changed=()=>{}}){
 let revision=null,siteId=null,items=[],sequence=0,dirty=false,epoch=0;
 let chooser=null,pageRows=null;
 const live=()=>site()?.site.id===siteId&&site()?.site.revision===revision;
 const decorate=rows=>rows.map(item=>({...item,uid:String(++sequence),children:decorate(item.children)}));
 const payload=rows=>rows.map(({key,label,href,children})=>({key,label,href,children:payload(children)}));
 const action=(key,id,uid='',disabled=false)=>'<button type="button" class="button" data-action="website-files-menu-'+id+'" data-menu-item="'+uid+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 function reset(){epoch++;revision=siteId=null;items=[];sequence=0;dirty=false;chooser=pageRows=null;}
 async function open(){
  const current=site(),token=++epoch;
  const result=await request('menu',{siteId:current.site.id,expectedRevision:current.site.revision});
  if(token!==epoch||site()?.site.id!==current.site.id||site()?.site.revision!==result.revision)return;
  revision=result.revision;siteId=current.site.id;items=decorate(result.items);dirty=false;chooser=pageRows=null;changed();render();
 }
 async function save(){
  if(!live())throw Error(tr('changed'));
  if(!dirty)return;
  const current=site(),token=epoch;
  const next=await request('menu/save',{siteId,expectedRevision:revision,path:current.path,items:payload(items)});
  if(token!==epoch||site()?.site.id!==siteId)return;
  dirty=false;adopt(next);changed();await open();
 }
 function locate(uid,rows=items,parent=null){
  for(let i=0;i<rows.length;i++){
   const item=rows[i],location={rows,i,item,parent};
   if(item.uid===uid)return location;
   const nested=locate(uid,item.children,location);if(nested)return nested;
  }return null;
 }
 function row(item,i,rows,nested){
  const id=item.uid,readonly=item.blocked?' disabled':'',choosing=chooser?.uid===id;
  return '<li><fieldset data-menu-row="'+id+'"><legend>'+esc(item.label||tr('menuNew'))+'</legend><label>'+esc(tr('menuLabel'))+'<input data-menu-field="label" value="'+esc(item.label)+'" maxlength="1000"'+readonly+'></label>'+
   '<label>'+esc(tr('menuLink'))+'<input data-menu-field="href" value="'+esc(item.href)+'" maxlength="4096" title="'+esc(tr('menuDestination'))+'"'+readonly+'></label>'+
   (item.blocked?'':'<button type="button" class="button" data-action="website-files-menu-pages" data-menu-item="'+id+'" aria-expanded="'+choosing+'"'+(choosing?' aria-controls="website-menu-pages-'+id+'"':'')+'>'+esc(tr('menuChoosePage'))+'</button>')+
   (choosing?'<section id="website-menu-pages-'+id+'" class="website-menu-pages" aria-label="'+esc(tr('menuChoosePage'))+'"><label>'+esc(tr('pageSearch'))+'<input type="search" data-menu-page-search value="'+esc(chooser.search)+'"></label><div data-menu-page-results>'+pageResults()+'</div>'+action('cancel','pages-close',id)+'</section>':'')+
   (item.managed?'<p>'+esc(tr('menuProtected'))+'</p>':'')+'<div>'+
   action('up','up',id,i===0)+action('down','down',id,i+1===rows.length)+action('menuIndent','indent',id,i===0)+action('menuOutdent','outdent',id,!nested)+action('menuChild','child',id)+action('remove','remove',id)+'</div></fieldset>'+
   (item.children.length?list(item.children,true):'')+'</li>';
 }
 function list(rows,nested=false){return '<ol>'+rows.map((item,i)=>row(item,i,rows,nested)).join('')+'</ol>';}
 function pageResults(){
  const result=websitePageWindow(pageRows,chooser);chooser.offset=result.start;chooser.window=result;
  const range=result.total?tr('pageRange',{start:result.start+1,end:result.end,total:result.total}):tr('noPageMatches');
  const rows=result.rows.map(page=>'<li><button type="button" class="button" data-action="website-files-menu-page-select" data-menu-item="'+chooser.uid+'" data-menu-path="'+esc(page.path)+'"><strong>'+esc(page.title||page.path)+'</strong> <code>'+esc(page.path)+'</code></button></li>');
  const nav=result.start||result.end<result.total?action('pageBack','pages-back',chooser.uid,!result.start)+action('pageForward','pages-next',chooser.uid,result.end===result.total):'';
  return '<p role="status">'+esc(range)+'</p>'+nav+(rows.length?'<ul>'+rows.join('')+'</ul>':'');
 }
 function focusRow(uid,selector){requestAnimationFrame(()=>document.querySelector('[data-menu-row="'+uid+'"] '+selector)?.focus());}
 function choosePage(op,element,item){
  if(!item||item.blocked)return;
  const id=item.uid;
  if(op==='pages'&&chooser?.uid!==id){
   pageRows??=websitePageRows(site().site.pages.filter(page=>!page.draft));chooser={uid:id,search:'',offset:0};render();focusRow(id,'[data-menu-page-search]');return;
  }
  if(chooser?.uid!==id)return;
  if(op==='pages-back'||op==='pages-next'){
   chooser.offset=op==='pages-next'?chooser.window.end:chooser.window.previous;
   render();focusRow(id,'[data-menu-path]');return;
  }
  if(op==='page-select'){
   const page=chooser.window.rows.find(row=>row.path===element.dataset.menuPath);if(!page)return;
   if(item.href!==page.path){item.href=page.path;mark();}
  }
  chooser=null;render();focusRow(id,'[data-action="website-files-menu-pages"]');
 }
 function view(){
  if(!live())return '<section class="panel"><p>'+esc(tr('changed'))+'</p>'+action('reopen','reload')+'</section>';
  return '<section class="panel website-files-menu" aria-label="'+esc(tr('menu'))+'"><h2>'+esc(tr('menu'))+'</h2>'+
   (items.length?list(items):'<p>'+esc(tr('menuEmpty'))+'</p>')+action('menuAdd','add')+action('menuSave','save','',!dirty)+action('cancel','cancel')+'</section>';
 }
 function mark(){
  dirty=true;changed();
  const button=document.querySelector('[data-action="website-files-menu-save"]');if(button)button.disabled=false;
 }
 function input(el){
  if(el.hasAttribute('data-menu-page-search')){
   if(chooser&&live()){chooser.search=el.value;chooser.offset=0;el.closest('.website-menu-pages').querySelector('[data-menu-page-results]').innerHTML=pageResults();}
   return true;
  }
  const field=el.dataset.menuField;if(!['label','href'].includes(field))return false;
  const found=locate(el.closest('[data-menu-row]')?.dataset.menuRow);if(found&&live()){found.item[field]=el.value;mark();}return true;
 }
 async function handle(operation,element){
  if(!operation.startsWith('menu-'))return false;
  const op=operation.slice(5);
  if(op==='reload'){await open();return true;}
  if(op==='cancel'){if(dirty&&!confirm(tr('discardConfirm')))return true;reset();changed();close();return true;}
  if(op==='save'){await save();return true;}
  if(!live())throw Error(tr('changed'));
  const found=locate(element.dataset.menuItem);let focus=null;
  if(op==='pages'||op.startsWith('pages-')||op==='page-select'){
   choosePage(op,element,found?.item);return true;
  }
  chooser=null;
  if(op==='add'||op==='child'){
   if(op==='child'&&!found)return true;
   const item={key:null,label:tr('menuNew'),href:'index.html',uid:String(++sequence),children:[]};
   (op==='add'?items:found.item.children).push(item);focus=item.uid;
  }else if(found){
   const {rows,i,item,parent}=found;
   if(op==='remove')rows.splice(i,1);
   else if(op==='up'&&i>0)rows.splice(i-1,0,...rows.splice(i,1));
   else if(op==='down'&&i<rows.length-1)rows.splice(i+1,0,...rows.splice(i,1));
   else if(op==='indent'&&i>0)rows[i-1].children.push(...rows.splice(i,1));
   else if(op==='outdent'&&parent)parent.rows.splice(parent.i+1,0,...rows.splice(i,1));
   else return true;
   if(op!=='remove')focus=item.uid;
  }else return true;
  mark();render();
  if(focus)document.querySelector('[data-menu-row="'+focus+'"] [data-menu-field="label"]')?.focus();
  return true;
 }
 return {open,save,reset,view,handle,input,dirty:()=>dirty};
}
