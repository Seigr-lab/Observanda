import {navigationItems,menuCanNest} from './website-model.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('websiteEditor',key,args);

// Menu visibility is presentation, independent of public-content consent.
// Unpublished destinations stay editable and never enter a public projection.
export function websiteNavigationFields(book,selection,{esc,field,option}){
 const items=navigationItems(book,selection),design=book.website.design;
 const move=(key,i,disabled)=>'<button type="button" class="button" data-action="menu-'+key+'" data-index="'+i+'" aria-label="'+esc(text('menuMove',{item:i+1,direction:text(key)}))+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
 return '<section class="panel website-navigation-controls"><h2>'+esc(text('navigationTitle'))+'</h2>'+field(text('navigationPlacement'),'<select data-site-design="navigation">'+['top','side','none'].map(value=>option(value,text('navigation_'+value),design.navigation)).join('')+'</select>')+
 '<label class="checkbox"><input type="checkbox" data-site-design="browseLink"'+(design.browseLink!==false?' checked':'')+'><span>'+esc(text('browseLink'))+'</span></label><p>'+esc(text('navigationHelp'))+'</p><button type="button" class="button" data-action="website-menu-clear">'+esc(text('clearMenu'))+'</button></section>'+
 '<section class="panel"><p id="website-order-help" class="website-visually-hidden">'+esc(text('menuKeyboard'))+'</p><ol id="website-menu-order" class="website-menu-order">'+items.map((item,i)=>'<li data-reorder-item="'+esc(item.target)+'"><button type="button" class="button drag-handle" aria-describedby="website-order-help" data-reorder-handle="'+esc(item.target)+'" aria-label="'+esc(text('menuHandle',{item:i+1}))+'">&#10303;</button><div class="website-menu-fields"><label class="checkbox"><input type="checkbox" data-menu="'+i+'" data-column="show"'+(item.show?' checked':'')+' aria-label="'+esc(text('menuShow',{name:item.label}))+'"></label><input data-menu="'+i+'" data-column="label" aria-label="'+esc(text('menuLabel',{item:i+1}))+'" value="'+esc(item.label)+'" maxlength="160">'+(!item.available?'<small class="muted">'+esc(text('menuUnpublished'))+'</small>':'')+'</div><div class="inline-actions">'+move('up',i,i===0)+move('down',i,i===items.length-1)+'</div><label class="menu-parent">'+esc(text('menuUnder'))+'<select data-menu="'+i+'" data-column="parent" aria-label="'+esc(text('menuParent',{item:i+1}))+'"><option value="">'+esc(text('menuTop'))+'</option>'+items.filter(p=>p.target!==item.target&&menuCanNest(items,item.target,p.target)).map(p=>option(p.target,p.label,item.parent)).join('')+'</select></label></li>').join('')+'</ol><p id="website-move-status" role="status"></p></section>';
}

// Effective menu discovery and selected edits share the durable document draft.
export function websiteNavigationUI({state,documents,esc,field,option,showDialog,render,changed,notify}){
 let identity=null,page=null,offset=0,search='',loading=false,error='',controller=null,epoch=0,session=null,parents=new Map();
 const active=()=>documents.enabled()&&state.page==='website';
 const key=()=>documents.viewKey();
 const label=(name,args)=>t('websitePages',name,args);
 const action=(name,title,extra='')=>'<button type="button" class="button" data-action="website-navigation-'+name+'" '+extra+'>'+esc(title)+'</button>';
 function sync(){if(identity!==key()){controller?.abort();identity=key();epoch++;page=null;offset=0;error='';loading=false;}if(!active()){controller?.abort();close();}}
 function controls(value,scope='window'){
  return '<div class="inline-actions">'+action('previous',label('previous'),'data-scope="'+scope+'" '+(!value?.offset?'disabled':''))+'<span role="status">'+esc(value?.total?text('documentMenuRange',{first:value.offset+1,last:value.offset+value.items.length,total:value.total}):text('documentMenuEmpty'))+'</span>'+action('next',label('next'),'data-scope="'+scope+'" '+(!value||value.offset+value.items.length>=value.total?'disabled':''))+'</div>';
 }
 function view(){sync();const design=state.book.website.design;
  return '<section class="panel website-navigation-controls"><h2>'+esc(text('navigationTitle'))+'</h2>'+field(text('navigationPlacement'),'<select data-site-design="navigation">'+['top','side','none'].map(value=>option(value,text('navigation_'+value),design.navigation)).join('')+'</select>')+'<label class="checkbox"><input type="checkbox" data-site-design="browseLink"'+(design.browseLink!==false?' checked':'')+'><span>'+esc(text('browseLink'))+'</span></label><p>'+esc(text('navigationHelp'))+'</p>'+action('clear',text('clearMenu'))+'</section><section class="panel" data-navigation-window aria-busy="'+loading+'">'+field(text('documentMenuSearch'),'<input id="website-navigation-search" type="search" maxlength="200" value="'+esc(search)+'">')+(error?'<p role="alert">'+esc(error)+'</p>'+action('retry',text('documentLoadRetry')):'')+(loading?'<p role="status">'+esc(text('documentLoading'))+'</p>':'')+'<ol class="website-menu-order" start="'+((page?.offset??0)+1)+'">'+(page?.items??[]).map(row=>{
   const item=state.book.website.navigation.find(item=>item.target===row.key)??row.value,i=row.position;
   return '<li><div class="website-menu-fields"><label class="checkbox"><input type="checkbox" data-native-menu="'+esc(row.key)+'" data-column="show"'+(item.show?' checked':'')+' aria-label="'+esc(text('menuShow',{name:item.label}))+'"></label><input data-native-menu="'+esc(row.key)+'" data-column="label" maxlength="160" value="'+esc(item.label)+'" aria-label="'+esc(text('menuLabel',{item:i+1}))+'">'+(row.available===false?'<small class="muted">'+esc(text('menuUnpublished'))+'</small>':'')+'</div><div class="inline-actions">'+action('up',text('up'),'data-key="'+esc(row.key)+'" '+(i===0?'disabled':''))+action('down',text('down'),'data-key="'+esc(row.key)+'" '+(i===documents.count('navigation')-1?'disabled':''))+'</div>'+action('parent',text('documentParent'),'data-key="'+esc(row.key)+'"')+'<span>'+esc(item.parent?(parents.get(item.parent)??text('menuUnder')):text('menuTop'))+'</span></li>';
  }).join('')+'</ol>'+controls(page)+'</section>';
 }
 function redraw(){const active=document.activeElement,searching=active?.id==='website-navigation-search',selection=searching?[active.selectionStart,active.selectionEnd]:null;render();if(searching){const next=document.querySelector('#website-navigation-search');next?.focus({preventScroll:true});if(selection)next?.setSelectionRange(...selection);}}
 async function load({focus=false}={}){controller?.abort();const request=++epoch,stamp=key(),control=controller=new AbortController();loading=true;error='';redraw();
  const current=()=>request===epoch&&stamp===key()&&active()&&document.querySelector('[data-navigation-window]');
  try{const result=await documents.window('navigation',{offset,limit:25,search,signal:control.signal});if(!current())return;
   const labels=new Map(result.items.map(row=>[row.key,row.value.label])),missing=[...new Set(result.items.map(row=>row.value.parent).filter(key=>key&&!labels.has(key)))];
   await Promise.all(missing.map(async key=>{const row=await documents.item('navigation',key,{signal:control.signal,retain:false});labels.set(key,row.value.label);}));
   if(!current())return;for(const row of result.items)documents.remember('navigation',row);parents=labels;page=result;offset=result.offset;
  }catch(reason){if(!control.signal.aborted&&current())error=reason.message;}
  finally{if(current()){loading=false;controller=null;redraw();if(focus)document.querySelector('[data-native-menu],#website-navigation-search')?.focus();}}
 }
 function bind(){sync();if(!document.querySelector('[data-navigation-window]')){if(controller){controller.abort();controller=null;epoch++;loading=false;}return;}if(active()&&!page&&!loading&&!error)void load();}
 function input(el){if(el.dataset.nativeMenu){const item=state.book.website.navigation.find(item=>item.target===el.dataset.nativeMenu);if(item){item[el.dataset.column]=el.type==='checkbox'?el.checked:el.value;changed();}return true;}if(el.id==='website-navigation-search'){search=el.value;offset=0;void load();return true;}return false;}
 function close(){const s=session;session=null;s?.controller?.abort();s?.unbind();if(s?.dialog.open)s.dialog.close();if(s)document.querySelector('[data-action="website-navigation-parent"][data-key="'+s.target+'"]')?.focus();}
 async function parent(target){close();await documents.flush();showDialog('<h2 id="dialog-title">'+esc(text('documentParent'))+'</h2><div data-navigation-parent><div data-parent-results></div>'+action('top',text('menuTop'))+action('cancel',label('cancel'))+'</div>');
  const root=document.querySelector('[data-navigation-parent]'),dialog=root.closest('dialog'),s=session={root,dialog,target,identity:key(),offset:0,page:null,controller:null};
  const valid=()=>session===s&&s.identity===key()&&active()&&root.isConnected&&dialog.open;
  const paint=async()=>{s.controller?.abort();const control=s.controller=new AbortController();root.querySelector('[data-parent-results]').innerHTML='<p role="status">'+esc(text('documentLoading'))+'</p>';try{const result=await documents.window('navigation',{offset:s.offset,limit:25,signal:control.signal});if(!valid()||control.signal.aborted)return;s.page=result;root.querySelector('[data-parent-results]').innerHTML='<ul>'+result.items.filter(row=>row.key!==target).map(row=>'<li>'+action('choose',row.value.label,'data-key="'+esc(row.key)+'"')+'</li>').join('')+'</ul>'+controls(result,'parent');}catch(reason){if(valid()&&!control.signal.aborted)root.querySelector('[data-parent-results]').innerHTML='<p role="alert">'+esc(reason.message)+'</p>'+action('retry-parent',text('documentRetry'));}};
  const click=async event=>{const button=event.target.closest('[data-action]');if(!button||!root.contains(button))return;event.preventDefault();event.stopPropagation();const name=button.dataset.action.slice(19);if(name==='cancel'){close();return;}if(!valid())return;try{if(name==='top'||name==='choose'){const item=(await documents.item('navigation',target)).value;item.parent=name==='top'?null:button.dataset.key;await documents.perform([{type:'replace',collection:'navigation',key:target,value:item}]);close();page=null;render();}else if(name==='retry-parent')void paint();else if(s.page&&['previous','next'].includes(name)){s.offset=Math.max(0,s.page.offset+(name==='next'?25:-25));void paint();}}catch(reason){if(valid())root.querySelector('[data-parent-results]').innerHTML='<p role="alert">'+esc(reason.message)+'</p>'+action('retry-parent',text('documentRetry'));}};
  const cancel=event=>{event.preventDefault();event.stopPropagation();close();},closed=()=>{if(!dialog.open&&session===s)close();};root.addEventListener('click',click);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',closed);s.unbind=()=>{root.removeEventListener('click',click);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',closed);};void paint();
 }
 async function handle(el){if(!el.dataset.action?.startsWith('website-navigation-'))return false;const name=el.dataset.action.slice(19);
  if(name==='previous'||name==='next'){offset=Math.max(0,(page?.offset??offset)+(name==='next'?25:-25));await load({focus:true});return true;}
  if(name==='retry'){await load();return true;}
  if(name==='parent'){await parent(el.dataset.key);return true;}
  if(name==='clear'){await documents.perform([{type:'menu-clear'},{type:'settings',path:['document','website','design'],value:{...state.book.website.design,browseLink:false}}]);page=null;render();changed();return true;}
  if(name==='up'||name==='down'){
   await documents.flush();const item=await documents.item('navigation',el.dataset.key),position=item.position;
   if(position===0&&name==='up'||position===documents.count('navigation')-1&&name==='down')return true;
   const near=await documents.window('navigation',{offset:Math.max(0,position-1),limit:4});const targetPosition=name==='up'?position-1:position+2,beforeKey=near.items.find(row=>row.position===targetPosition)?.key??null;
   await documents.perform([{type:'navigation-move',key:item.key,beforeKey}]);page=null;render();changed();return true;
  }return false;
 }
 return {view,bind,input,action:handle,sync};
}
