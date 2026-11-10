import {websitePageRows,websitePageWindow} from './website-files-pages.js';
import {confirmAction} from './confirm-action.js';
import {mountMenuPreview} from './website-menu-canvas.js';
import {operationProgress} from './operation-progress-ui.js';
import {validWebsiteLink} from './website-files-text-link.js';

function flatten(items,depth=0,result=[]){
 for(const item of items){result.push({item,depth});flatten(item.children,depth+1,result);}
 return result;
}
function locate(uid,rows,parent=null){
 for(let i=0;i<rows.length;i++){
  const item=rows[i],location={rows,i,item,parent};if(item.uid===uid)return location;
  const found=locate(uid,item.children,location);if(found)return found;
 }
}
export function moveMenuItem(items,uid,destination,where){
 const from=locate(uid,items),to=locate(destination,items);if(!from||!to)return false;
 for(let n=to;n;n=n.parent)if(n.item===from.item)return false;
 const rows=where==='inside'?to.item.children:to.rows;let at=where==='inside'?rows.length:to.i+(where==='after'?1:0);
 if(from.rows===rows&&from.i<at)at--;if(from.rows===rows&&from.i===at)return false;
 from.rows.splice(from.i,1);rows.splice(at,0,from.item);return true;
}
export function websiteFilesMenu({request,site,esc,tr,render,adopt,close,baseURL,run,changed=()=>{}}){
 let revision=null,siteId=null,menuId=null,menus=[],name='',position='header',creating=false;
 let items=[],sequence=0,selected=null,dirty=false,epoch=0,chooser=null,pageRows=null,paintPreview=null,filter='',offset=0;
 const live=()=>site()?.site.id===siteId&&site()?.site.revision===revision;
 const decorate=rows=>rows.map(item=>({...item,initialLabel:item.label,initialHref:item.href,uid:String(++sequence),children:decorate(item.children)}));
 const payload=rows=>rows.map(({key,label,href,children})=>({key,label,href,children:payload(children)}));
 const action=(key,id,uid='',disabled=false)=>'<button type="button" class="button" data-action="website-files-menu-'+id+'" data-menu-item="'+uid+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 const panel=()=>document.querySelector('.website-files-menu');
 function focusField(selector,selectText=false){
  requestAnimationFrame(()=>{const el=panel()?.querySelector(selector);if(el){el.focus();if(selectText)el.select();}});
 }
 function reset(){epoch++;revision=siteId=menuId=null;items=[];menus=[];sequence=0;dirty=creating=false;chooser=pageRows=paintPreview=selected=null;filter='';offset=0;}
 async function open(id=null,paint=true){
  const current=site(),token=++epoch,selectedKey=menuId===id?locate(selected,items)?.item.key:null;
  const result=await request('menu',{siteId:current.site.id,expectedRevision:current.site.revision,menuId:id});
  if(token!==epoch||site()?.site.id!==current.site.id||site()?.site.revision!==result.revision)return;
  revision=result.revision;siteId=current.site.id;menus=result.menus??[];menuId=id;const definition=menus.find(m=>m.id===id);
  name=definition?.name??tr('menuPrimary');position=definition?.position??'header';items=decorate(result.items);
  selected=flatten(items).find(r=>r.item.key===selectedKey)?.item.uid??items[0]?.uid??null;
  dirty=creating=false;chooser=pageRows=null;filter='';offset=0;changed();if(paint)render();
 }
 async function save(remove=false){
  if(!live())throw Error(tr('changed'));if(!dirty&&!remove)return;
  const current=site(),token=epoch;
  const data={siteId,expectedRevision:revision,path:current.path,menuId,name:name.trim(),position,create:creating,remove,items:payload(items)};
  if(menuId&&!data.name){focusField('[data-menu-name]');throw Error(tr('menuName'));}
  if(!remove){
   const pages=new Set(current.site.pages.filter(p=>!p.draft).map(p=>p.path));
   for(const {item} of flatten(items)){
    if(item.blocked)continue;
    const label=!item.label.trim()&&(!item.key||item.label!==item.initialLabel);
    const href=item.href!==item.initialHref&&(!validWebsiteLink(item.href,baseURL('index.html'))||
     !/^(?:#|[a-z][a-z0-9+.-]*:)/i.test(item.href)&&!pages.has(item.href.split('#')[0]));
    if(label||href){select(item.uid);focusField('[data-menu-field="'+(label?'label':'href')+'"]');throw Error(tr(label?'menuMissingLabel':'menuInvalidLink'));}
   }
  }
  const host=panel(),progress=host?operationProgress({host,stageText:tr,title:()=>tr('menuSave'),compact:true,disableControls:false}):null;
  let next;try{next=await request('menu/save',data,progress?{onProgress:progress.update}:undefined);}finally{progress?.close();}
  if(token!==epoch||site()?.site.id!==siteId)return;
  dirty=false;adopt(next);changed();await open(remove?null:menuId);
 }
 function mark(){dirty=true;changed();const saveButton=panel()?.querySelector('[data-action="website-files-menu-save"]');if(saveButton)saveButton.disabled=false;}
 function visibleRows(){const q=filter.trim().toLocaleLowerCase();return flatten(items).filter(({item})=>!q||(item.label+' '+item.href).toLocaleLowerCase().includes(q));}
 function tree(){
  const rows=visibleRows();offset=Math.min(offset,Math.floor(Math.max(0,rows.length-1)/40)*40);
  return '<ol class="menu-outline">'+rows.slice(offset,offset+40).map(({item,depth})=>'<li data-menu-node="'+item.uid+'" data-depth="'+depth+'" data-indent="'+Math.min(depth,6)+'"><button class="menu-grip" type="button" draggable="true" data-menu-grip="'+item.uid+'" aria-label="'+esc(tr('menuMove')+' '+(item.label||tr('menuProtected')))+'">⠿</button><button type="button" class="menu-tree-label" aria-pressed="'+(item.uid===selected)+'" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight" data-action="website-files-menu-select" data-menu-item="'+item.uid+'">'+esc(item.label||tr('menuProtected'))+'</button></li>').join('')+'</ol>'+
   (rows.length>40?'<div class="menu-nav">'+action('pageBack','prior','',offset===0)+esc(tr('pageRange',{start:offset+1,end:Math.min(rows.length,offset+40),total:rows.length}))+action('pageForward','more','',offset+40>=rows.length)+'</div>':'')+
   (!rows.length?'<p>'+esc(tr(filter?'noPageMatches':'menuEmpty'))+'</p>':'');
 }
 function details(){
  const found=locate(selected,items);if(!found)return '<p>'+esc(tr('menuSelectHint'))+'</p>';
  const {item,i,rows,parent}=found,id=item.uid,readonly=item.blocked?' disabled':'',choosing=chooser?.uid===id;
  return '<section data-menu-row="'+id+'"><label>'+esc(tr('menuLabel'))+'<input data-menu-field="label" value="'+esc(item.label)+'" maxlength="1000"'+readonly+'></label>'+
   '<label>'+esc(tr('menuLink'))+'<input data-menu-field="href" value="'+esc(item.href)+'" maxlength="4096" title="'+esc(tr('menuDestination'))+'"'+readonly+'></label>'+
   (item.blocked?'':action('menuChoosePage','pages',id))+
   (choosing?'<section class="website-menu-pages" aria-label="'+esc(tr('menuChoosePage'))+'"><label>'+esc(tr('pageSearch'))+'<input type="search" data-menu-page-search value="'+esc(chooser.search)+'"></label><div data-menu-page-results>'+pageResults()+'</div>'+action('cancel','pages-close',id)+'</section>':'')+
   (item.managed?'<p>'+esc(tr('menuProtected'))+'</p>':'')+
   '<div class="menu-actions">'+action('menuChild','child',id)+action('remove','remove',id)+'</div><details class="menu-arrange"><summary>'+esc(tr('menuMove'))+'</summary><div class="menu-actions">'+action('up','up',id,i===0)+action('down','down',id,i+1===rows.length)+action('menuIndent','indent',id,i===0)+action('menuOutdent','outdent',id,!parent)+'</div></details></section>';
 }
 function pageResults(){
  const result=websitePageWindow(pageRows,chooser);chooser.offset=result.start;chooser.window=result;
  const range=result.total?tr('pageRange',{start:result.start+1,end:result.end,total:result.total}):tr('noPageMatches');
  const rows=result.rows.map(page=>'<li><button type="button" class="button" data-action="website-files-menu-page-select" data-menu-item="'+chooser.uid+'" data-menu-path="'+esc(page.path)+'"><strong>'+esc(page.title||page.path)+'</strong> <code>'+esc(page.path)+'</code></button></li>');
  const nav=result.start||result.end<result.total?action('pageBack','pages-back',chooser.uid,!result.start)+action('pageForward','pages-next',chooser.uid,result.end===result.total):'';
  return '<p role="status">'+esc(range)+'</p>'+nav+(rows.length?'<ul>'+rows.join('')+'</ul>':'');
 }
 function view(){
  if(!live())return '<section class="panel"><p>'+esc(tr('changed'))+'</p>'+action('reopen','reload')+'</section>';
  const choices=[{id:'',name:tr('menuPrimary')},...menus,...(creating?[{id:menuId,name}]:[])];
  const options=choices.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===(menuId??'')?' selected':'')+'>'+esc(m.name)+'</option>').join('');
  const properties=menuId?'<label>'+esc(tr('menuName'))+'<input data-menu-name value="'+esc(name)+'" maxlength="120"></label><label>'+esc(tr('menuLocation'))+'<select data-menu-position>'+['header','footer'].map(p=>'<option value="'+p+'"'+(position===p?' selected':'')+'>'+esc(tr(p==='header'?'menuHeader':'menuFooter'))+'</option>').join('')+'</select></label>'+(!creating?action('menuDelete','delete'):''):'';
  return '<section class="panel website-files-menu" aria-label="'+esc(tr('menu'))+'"><header><div><h2>'+esc(tr('menu'))+'</h2><p>'+esc(tr('menuScope'))+'</p></div>'+
   '<div class="menu-actions"><label>'+esc(tr('menuChoose'))+'<select data-menu-switch>'+options+'</select></label>'+action('menuCreate','create')+action('menuSave','save','',!dirty)+action('closePreview','cancel')+'</div></header>'+
   (properties?'<div class="menu-properties">'+properties+'</div>':'')+
   '<div class="menu-workspace"><section><h3>'+esc(tr('menuStructure'))+'</h3><label>'+esc(tr('menuFilter'))+'<input type="search" data-menu-filter value="'+esc(filter)+'"></label><p class="hint">'+esc(tr('menuDragHint'))+'</p><div data-menu-outline>'+tree()+'</div>'+action('menuAdd','add')+'</section>'+
   '<section><h3>'+esc(tr('menuPreview'))+'</h3><iframe data-menu-preview title="'+esc(tr('menuPreview'))+'" sandbox="allow-same-origin"></iframe><h3>'+esc(tr('menuItem'))+'</h3><div data-menu-details>'+details()+'</div></section></div></section>';
 }
 function paint(selector){
  const root=panel();if(!root)return;
  root.querySelector('[data-menu-outline]').innerHTML=tree();root.querySelector('[data-menu-details]').innerHTML=details();paintPreview?.();
  if(selector)focusField(selector);
 }
 function select(uid,focus=false){
  if(!locate(uid,items))return;selected=uid;chooser=null;
  let i=visibleRows().findIndex(r=>r.item.uid===uid);if(i<0){filter='';panel().querySelector('[data-menu-filter]').value='';i=visibleRows().findIndex(r=>r.item.uid===uid);}
  offset=Math.floor(i/40)*40;paint(focus?'[data-menu-row] input:not(:disabled)':null);
 }
 function bind(){
  const root=panel(),frame=root?.querySelector('[data-menu-preview]');if(!frame)return;
  paintPreview=mountMenuPreview(frame,site(),baseURL,()=>({items,id:menuId,name,position}),uid=>select(uid));
  root.querySelector('[data-menu-switch]').onchange=e=>{const el=e.target;void run(()=>switchMenu(el));};
  const outline=root.querySelector('[data-menu-outline]');let source=null,indicated=null;
  function resetDrop(){if(indicated)delete indicated.dataset.menuDrop;indicated=null;}
  function dropTarget(event){
   const row=event.target.closest('[data-menu-node]');if(!source||!row||!outline.contains(row))return null;
   const target=locate(row.dataset.menuNode,items);
   for(let n=target;n;n=n.parent)if(n.item.uid===source)return null;
   const rect=row.getBoundingClientRect(),ratio=(event.clientY-rect.top)/rect.height;
   return {row,where:ratio<.27?'before':ratio>.73?'after':'inside'};
  }
  outline.ondragstart=e=>{source=e.target.closest('[data-menu-grip]')?.dataset.menuGrip;if(!source){e.preventDefault();return;}e.dataTransfer.setData('text/plain',source);e.dataTransfer.effectAllowed='move';};
  outline.ondragover=e=>{resetDrop();const target=dropTarget(e);if(!target)return;e.preventDefault();e.dataTransfer.dropEffect='move';indicated=target.row;indicated.dataset.menuDrop=target.where;};
  outline.ondragleave=e=>{if(!outline.contains(e.relatedTarget))resetDrop();};
  outline.ondragend=()=>{source=null;resetDrop();};
  outline.ondrop=e=>{const target=dropTarget(e);resetDrop();if(!target)return;e.preventDefault();const uid=source;source=null;if(moveMenuItem(items,uid,target.row.dataset.menuNode,target.where)){mark();select(uid);}};
  outline.onclick=e=>{const grip=e.target.closest('[data-menu-grip]');if(grip)select(grip.dataset.menuGrip,true);};
  outline.onkeydown=e=>{
   const row=e.target.closest('[data-menu-node]');if(!row||e.ctrlKey||e.metaKey||e.shiftKey)return;
   const uid=row.dataset.menuNode;
   if(e.altKey){
    const op={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'outdent',ArrowRight:'indent'}[e.key];if(!op)return;
    e.preventDefault();selected=uid;void handle('menu-'+op,{dataset:{menuItem:uid}}).then(()=>focusField('[data-menu-node="'+uid+'"] .menu-tree-label'));return;
   }
   const rows=visibleRows(),i=rows.findIndex(r=>r.item.uid===uid);
   const at={ArrowUp:i-1,ArrowDown:i+1,Home:0,End:rows.length-1}[e.key];
   if(at===undefined)return;e.preventDefault();
   const target=rows[Math.max(0,Math.min(at,rows.length-1))].item.uid;select(target);focusField('[data-menu-node="'+target+'"] .menu-tree-label');
  };
 }
 function choosePage(op,element,item){
  if(!item||item.blocked)return;const uid=item.uid;
  if(op==='pages'&&chooser?.uid!==uid){pageRows??=websitePageRows(site().site.pages.filter(p=>!p.draft));chooser={uid,search:'',offset:0};paint('[data-menu-page-search]');return;}
  if(chooser?.uid!==uid)return;
  if(op==='pages-back'||op==='pages-next'){chooser.offset=op==='pages-next'?chooser.window.end:chooser.window.previous;paint('[data-menu-path]');return;}
  if(op==='page-select'){const page=chooser.window.rows.find(p=>p.path===element.dataset.menuPath);if(!page)return;if(item.href!==page.path){item.href=page.path;mark();}}
  chooser=null;paint('[data-action="website-files-menu-pages"]');
 }
 function input(el){
  if(!el.closest('.website-files-menu')||!live())return false;
  if(el.hasAttribute('data-menu-page-search')){if(chooser){chooser.search=el.value;chooser.offset=0;el.closest('.website-menu-pages').querySelector('[data-menu-page-results]').innerHTML=pageResults();}return true;}
  if(el.hasAttribute('data-menu-filter')){filter=el.value;offset=0;panel().querySelector('[data-menu-outline]').innerHTML=tree();return true;}
  if(el.hasAttribute('data-menu-name')){name=el.value;mark();paintPreview?.();return true;}
  if(el.hasAttribute('data-menu-position')){if(position!==el.value){position=el.value;mark();render();}return true;}
  if(el.hasAttribute('data-menu-switch'))return true;
  const field=el.dataset.menuField;if(!['label','href'].includes(field))return false;
  const found=locate(selected,items);
  if(found&&!found.item.blocked&&found.item[field]!==el.value){
   found.item[field]=el.value;mark();
   if(filter)panel().querySelector('[data-menu-outline]').innerHTML=tree();
   else if(field==='label'){
    const row=panel().querySelector('[data-menu-node="'+selected+'"]');
    const label=found.item.label||tr('menuNew');
    if(row){row.querySelector('.menu-tree-label').textContent=label;row.querySelector('[data-menu-grip]').setAttribute('aria-label',tr('menuMove')+' '+label);}
   }
   paintPreview?.(found.item);
  }
  return true;
 }
 async function switchMenu(el){if(dirty&&!await confirmAction(tr('discardConfirm'),{action:'discard'})){el.value=menuId??'';return;}await open(el.value||null);}
 async function handle(operation,element){
  if(!operation.startsWith('menu-'))return false;const op=operation.slice(5);
  if(op==='reload'){await open(menuId);return true;}
  if(op==='cancel'){if(dirty&&!await confirmAction(tr('discardConfirm'),{action:'discard'}))return true;reset();changed();close();return true;}
  if(op==='save'){await save();return true;}
  if(!live())throw Error(tr('changed'));
  if(op==='switch'){await switchMenu(element);return true;}
  if(op==='create'){
   if(dirty&&!await confirmAction(tr('discardConfirm'),{action:'discard'}))return true;
   menuId=crypto.randomUUID();name=tr('menuCreate');position='header';items=[];selected=chooser=null;creating=true;filter='';offset=0;mark();render();focusField('[data-menu-name]',true);return true;
  }
  if(op==='delete'){if(!creating&&menuId&&await confirmAction(tr('menuRemoveConfirm'),{action:'delete'}))await save(true);return true;}
  if(op==='prior'||op==='more'){offset+=op==='more'?40:-40;paint('[data-menu-node] .menu-tree-label');return true;}
  const found=locate(element.dataset.menuItem,items);
  if(op==='select'){select(found?.item.uid,true);return true;}
  if(op==='pages'||op.startsWith('pages-')||op==='page-select'){choosePage(op,element,found?.item);return true;}
  chooser=null;
  if(op==='add'||op==='child'){
   if(op==='child'&&!found)return true;
   const item={key:null,label:tr('menuNew'),href:'index.html',uid:String(++sequence),children:[]};(op==='add'?items:found.item.children).push(item);
   mark();select(item.uid,true);focusField('[data-menu-field=label]',true);return true;
  }
  if(!found)return true;const {item,rows,i,parent}=found;
  if(op==='remove'){rows.splice(i,1);selected=rows[i]?.uid??rows[i-1]?.uid??parent?.item.uid??null;}
  else if(op==='up'&&i>0)moveMenuItem(items,item.uid,rows[i-1].uid,'before');
  else if(op==='down'&&i+1<rows.length)moveMenuItem(items,item.uid,rows[i+1].uid,'after');
  else if(op==='indent'&&i>0)moveMenuItem(items,item.uid,rows[i-1].uid,'inside');
  else if(op==='outdent'&&parent)moveMenuItem(items,item.uid,parent.item.uid,'after');
  else return true;
  mark();if(selected)select(selected,true);else paint('[data-action="website-files-menu-add"]');return true;
 }
 return {open,save,reset,view,handle,input,bind,dirty:()=>dirty};
}
