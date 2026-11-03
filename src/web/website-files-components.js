import {websiteRichText} from './website-files-visual-rich.js';
import {layerPath,websiteLayerAt} from './website-layer-model.js';

const marker='data-website-instance',dragType='application/x-observanda-component';
const blocks='section,article,aside,div,figure,table,p,h1,h2,h3,h4,h5,h6,blockquote,ol,ul,dl,details,pre,hr,img,video,audio';
const container='body,main,section,article,aside,div,blockquote,li,dd';
const protectedArea='header,nav,footer,template,[hidden],[data-record-id],[data-public-record],[data-feed-item],[data-observanda-source],[data-observanda-link],[data-observanda-part],[data-website-instance],[data-website-menu],[data-website-feed],[data-website-feed-source],[data-website-source-gallery],[data-image-gallery]';
const caption=node=>(node?.querySelector('h1,h2,h3,h4,h5,h6,figcaption,caption')?.textContent||node?.textContent||node?.localName||'').trim().replace(/\s+/g,' ').slice(0,100);
export function websiteFilesComponents({request,tr,esc,site,selected,save,adopt,render,run,notify,showInstance}){
 let opened=false,items=[],query='',name='',position='end',offset=0,next=null,revision=null,total=0,drag=null,canvas=null,dialog=null,epoch=0,controller=null,debounce=null;
 let usage=null,removeId=null;
 const button=(key,op,extra='')=>'<button type="button" class="button" data-action="website-files-component-'+op+'" '+extra+'>'+esc(tr(key))+'</button>';
 const local=()=>({siteId:site().site.id,expectedRevision:site().site.revision,path:site().path});
 const panel=()=>document.querySelector('[data-website-components]');
 function closeDialog(){dialog?.close();dialog=null;}
 function reset(){epoch++;controller?.abort();controller=null;clearTimeout(debounce);closeDialog();canvas=null;opened=false;items=[];query=name='';offset=total=0;usage=removeId=next=revision=drag=null;position='end';}
 function pageChange(sameSite){
  const keep=sameSite&&opened,term=query;reset();if(keep){opened=true;query=term;}
 }
 function tabs(){return '<nav class="component-rail-tabs" aria-label="'+esc(tr('componentPanels'))+'">'+button('structure','close','aria-pressed="'+!opened+'"')+button('componentLibrary','browse','aria-pressed="'+opened+'" aria-controls="website-component-library"')+'</nav>';}
 function view(){
  return '<section class="panel website-files-components" data-website-components id="website-component-library"'+(opened?'':' hidden')+'>'+body()+'</section>';
 }
 function body(){
  if(!opened)return '';
  return '<h2>'+esc(tr('componentLibrary'))+'</h2><p class="hint">'+esc(tr('componentLibraryHint'))+'</p>'+
   '<div class="component-source"><strong>'+esc(tr('componentSelection'))+'</strong><p data-component-selection></p><div data-component-create><label>'+esc(tr('componentName'))+'<input maxlength="100" data-component-field="name" value="'+esc(name)+'"></label>'+button('componentCreate','create')+'</div>'+button('componentDetach','detach','hidden')+'</div>'+
   '<form data-component-search><label>'+esc(tr('componentSearch'))+'<input type="search" maxlength="100" data-component-field="query" value="'+esc(query)+'"></label><button class="button" type="submit">'+esc(tr('pickerFind'))+'</button></form>'+
   '<label>'+esc(tr('pickerPosition'))+'<select data-component-field="position">'+[['before','componentBefore'],['after','componentAfter'],['end','pickerEnd']].map(([v,k])=>'<option value="'+v+'" '+(v===position?'selected':'')+'>'+esc(tr(k))+'</option>').join('')+'</select></label>'+
   '<div data-component-results aria-live="polite"></div>';
 }
 function context(){
  const selectedNode=canvas?.isConnected?websiteLayerAt(canvas,selected()):null;
  const instance=selectedNode?.closest('['+marker+']');
  const reusable=Boolean(selectedNode?.matches(blocks)&&!selectedNode.closest(protectedArea)&&!selectedNode.querySelector(protectedArea));
  return {selectedNode,instance,reusable};
 }
 function selection(){
  const host=panel();if(!opened||!host)return;
  const {selectedNode,instance,reusable}=context(),selectedText=host.querySelector('[data-component-selection]');
  if(!selectedText)return;
  selectedText.textContent=selectedNode?caption(selectedNode)+(reusable||instance?'':' · '+tr('componentProtected')):tr('componentChooseSection');
  host.querySelector('[data-component-create]').hidden=!reusable;
  host.querySelector('[data-action$="component-create"]').disabled=!name.trim()||!reusable;
  host.querySelector('[data-action$="component-detach"]').hidden=!instance;
  for(const b of host.querySelectorAll('[data-action$="component-insert"]'))b.disabled=position!=='end'&&!canPlace(selectedNode);
 }
 function canPlace(node){return Boolean(node?.parentElement?.matches(container)&&!node.parentElement.closest(protectedArea)&&!node.matches('main,nav,header,footer'));}
 function results(){
  const target=panel()?.querySelector('[data-component-results]');if(!target)return;
  if(revision!==site()?.site.revision){target.textContent=tr('loading');return;}
  const range=items.length?'<p class="hint">'+esc(tr('componentResults',{first:offset+1,last:offset+items.length,total}))+'</p>':'';
  const row=item=>{
   const data='data-component="'+esc(item.id)+'"',uses=esc(tr('componentUsage',{instances:item.instances,pages:item.pages}))+(item.draft?' · '+esc(tr('componentDraft')):'');
   const actions=button('componentInsert','insert',data)+button('componentEdit','edit',data)+button('componentUses','uses',data+' aria-expanded="'+(usage?.id===item.id)+'"');
   const remove=!item.removable?'':item.id===removeId?'<p>'+esc(tr('componentConfirmRemove',{name:item.name}))+'</p>'+button('remove','remove',data)+button('cancel','keep',data):button('remove','ask-remove',data);
   return '<li draggable="true" data-component-drag="'+esc(item.id)+'"><strong>'+esc(item.name)+'</strong><small>'+uses+'</small><div>'+actions+remove+'</div>'+usageView(item.id)+'</li>';
  };
  target.innerHTML=range+(items.length?'<ul>'+items.map(row).join('')+'</ul>':'<p>'+esc(tr(query?'componentEmpty':'componentLibraryEmpty'))+'</p>')+
   '<div class="inline-actions">'+(offset?button('pickerPrevious','previous'):'')+(next!==null?button('pickerNext','next'):'')+'</div>';
  selection();
 }
 function usageView(id){
  if(usage?.id!==id)return '';
  const links=usage.items.map(row=>'<button class="button" type="button" data-action="website-files-component-locate" data-instance="'+esc(row.instance)+'">'+esc(row.title)+'<small>'+esc(row.path)+'</small></button>').join('');
  return '<section class="component-uses" aria-label="'+esc(tr('componentUses'))+'">'+(links||'<p>'+esc(tr('componentNoUses'))+'</p>')+
   (usage.start?button('pickerPrevious','previous-uses'):'')+(usage.next!==null?button('pickerNext','next-uses'):'')+'</section>';
 }
 async function usagePage(id,start){
  const pin=local(),token=epoch,value=await request('components/usage',{...pin,component:id,offset:start});
  if(!opened||token!==epoch||site()?.site.id!==pin.siteId||site()?.site.revision!==pin.expectedRevision||site()?.path!==pin.path)return;
  usage={...value,id,start};results();
  panel()?.querySelector('[data-component-drag="'+CSS.escape(id)+'"] [data-action$="component-uses"]')?.focus({preventScroll:true});
 }
 async function list(start=0){
  controller?.abort();const task=controller=new AbortController(),token=++epoch,pin=local();
  revision=null;usage=removeId=null;results();
  try{
   const value=await request('components/list',{...pin,offset:start,query},{signal:task.signal});
   if(token!==epoch||site()?.site.id!==pin.siteId||site()?.path!==pin.path||site()?.site.revision!==value.revision)return;
   offset=start;next=value.next;total=value.total;revision=value.revision;items=value.items;results();
  }catch(error){
   if(error.name==='AbortError'||task.signal.aborted)return;
   const target=panel()?.querySelector('[data-component-results]');if(target)target.textContent=error.message||tr('failed');
   if(['ACCESS_LOCKED','AUTH','WEBSITE_CHANGED','CONFLICT','PUBLICATION_PERMISSIONS_CHANGED'].includes(error.code))throw error;
  }finally{if(token===epoch)controller=null;}
 }
 function browse(open){
  if(!open){const current=canvas;reset();canvas=current;}else opened=true;
  const host=panel();if(!host)return;
  host.hidden=!open;host.innerHTML=body();
  const tabs=host.parentElement.querySelector('.component-rail-tabs');if(tabs){tabs.querySelector('[data-action$="-browse"]').setAttribute('aria-pressed',String(open));tabs.querySelector('[data-action$="-close"]').setAttribute('aria-pressed',String(!open));}
  host.parentElement.scrollTop=0;bind();
  if(open)host.querySelector('[data-component-field=query]')?.focus({preventScroll:true});
 }
 function report(error){if(error.name!=='AbortError')notify?.(error.message||tr('failed'),true);}
 function input(el){
  const field=el?.dataset?.componentField;if(!field)return false;
  if(field==='name'){name=el.value;selection();}
  if(field==='query'&&query!==el.value){
   query=el.value;clearTimeout(debounce);controller?.abort();revision=null;results();
   debounce=setTimeout(()=>void list().catch(report),180);
  }
  if(field==='position'){position=el.value;selection();}
  return true;
 }
 async function write(op,options){
  const pin=local(),result=await request('components/'+op,{...pin,...options});
  if(site()?.site.id!==pin.siteId||site()?.path!==pin.path||site().site.revision!==pin.expectedRevision)return;
  closeDialog();adopt(result);if(op==='create'){name='';query='';}revision=null;render();
 }
 async function place(id,where,blockPath){
  if(where!=='end'&&!blockPath)throw Error(tr('componentSelect'));
  await save();await write('insert',{component:id,position:where,blockPath});
 }
 function editor(value,pin){
  closeDialog();const host=document.createElement('dialog');dialog=host;host.className='website-author-dialog';host.setAttribute('aria-label',tr('componentEdit'));
  host.innerHTML='<h2>'+esc(tr('componentEdit'))+'</h2><p>'+esc(tr('componentApplyHelp'))+'</p><label>'+esc(tr('componentName'))+'<input data-main-name maxlength="100"></label>'+
   '<div data-main-tools></div><iframe data-main-canvas sandbox="allow-same-origin" title="'+esc(tr('componentEdit'))+'"></iframe><details><summary>'+esc(tr('html'))+'</summary><label>'+esc(tr('componentMarkup'))+'<textarea data-main-source rows="7"></textarea></label></details>'+
   '<p role="alert" data-main-error></p><div class="inline-actions"><button type="button" data-main-apply>'+esc(tr('componentApply'))+'</button><button type="button" data-main-cancel>'+esc(tr('cancel'))+'</button></div>';
  const title=host.querySelector('[data-main-name]'),source=host.querySelector('textarea'),frame=host.querySelector('iframe'),apply=host.querySelector('[data-main-apply]');
  title.value=value.name;source.value=value.html;
  // Only admitted server markup is loaded into the interactive frame.
  // User-entered HTML stays inert until the server validates the new main.
  const tools=host.querySelector('[data-main-tools]');
  let code=false;source.oninput=()=>{code=true;frame.inert=true;tools.inert=true;};
  frame.onload=()=>{
   const doc=frame.contentDocument;if(!doc||!host.isConnected)return;
   const fragment=doc.createElement('template');fragment.innerHTML=value.html;
   doc.body.replaceChildren(fragment.content);doc.body.contentEditable='true';
   const style=doc.createElement('style');style.textContent=site()?.css??'';doc.head.append(style);
   doc.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
   doc.addEventListener('drop',e=>e.preventDefault());
   doc.body.oninput=()=>{if(!code)source.value=doc.body.innerHTML;};
   const make=(tag,text)=>{const el=host.ownerDocument.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
   const rich=websiteRichText({document:doc,host:host.ownerDocument,t:tr,make,listen:(node,type,cb,options)=>node.addEventListener(type,cb,options),
    safeRange:range=>!code&&host.open&&frame.contentDocument===doc&&doc.body.contains(range.commonAncestorContainer),
    beforeChange:()=>{},change:()=>{source.value=doc.body.innerHTML;}});
   tools.replaceChildren(rich.toolbar);
  };
  const url='/api/website-files/preview/'+encodeURIComponent(pin.siteId)+'/'+encodeURIComponent(pin.expectedRevision)+'/index.html?canvas=1';
  frame.src=url;
  host.querySelector('[data-main-cancel]').onclick=()=>host.close();
  apply.onclick=()=>{void run(async()=>{
   try{
    if(site()?.site.revision!==pin.expectedRevision||site().site.id!==pin.siteId)throw Error(tr('changed'));
    await write('update',{component:value.id,name:title.value,html:source.value});
   }catch(error){host.querySelector('[data-main-error]').textContent=error.message||tr('failed');throw error;}
  });};
  host.addEventListener('close',()=>{if(dialog===host)dialog=null;host.remove();},{once:true});
  document.body.append(host);host.showModal();title.focus();
 }
 async function action(operation,el){
  if(!operation.startsWith('component-'))return false;
  const op=operation.slice(10);
  if(op==='close'||op==='browse'){if(opened!==(op==='browse'))browse(op==='browse');return true;}
  if(op==='search'){clearTimeout(debounce);await list();return true;}
  if(op==='next'||op==='previous'){await list(op==='next'?next:Math.max(0,offset-12));return true;}
  const id=el.dataset.component,path=selected(),instance=context().instance?.getAttribute(marker);
  if(op==='ask-remove'||op==='keep'){removeId=op==='keep'?null:id;results();panel()?.querySelector('[data-component="'+CSS.escape(id)+'"][data-action$="'+(removeId?'component-remove':'component-ask-remove')+'"]')?.focus();return true;}
  if(op==='remove'){if(id!==removeId)return true;await save();await write('remove',{component:id});return true;}
  if(op==='uses'){if(usage?.id===id){usage=null;results();panel()?.querySelector('[data-component="'+CSS.escape(id)+'"][data-action$="component-uses"]')?.focus();}else await usagePage(id,0);return true;}
  if(op==='previous-uses'||op==='next-uses'){if(usage)await usagePage(usage.id,op==='next-uses'?usage.next:Math.max(0,usage.start-12));return true;}
  if(op==='locate'){
   const row=usage?.items.find(row=>row.instance===el.dataset.instance);if(row)await showInstance(row,usage.revision);return true;
  }
  if(op==='insert')await place(id,position,path);
  if(op==='create'){if(!context().reusable||!name.trim())throw Error(tr('componentSelect'));await save();await write(op,{name,blockPath:path});}
  if(op==='detach'){if(!instance)throw Error(tr('componentSelectInstance'));await save();await write(op,{instance});}
  if(op==='edit'){await save();const pin=local(),value=await request('components/main',{...pin,component:id});if(site()?.site.revision===value.revision&&site().site.id===pin.siteId)editor(value,pin);}
  return true;
 }
 function bind(){
  const host=panel();if(!host||!opened)return;
  const search=host.querySelector('[data-component-search]');search.onsubmit=e=>{e.preventDefault();clearTimeout(debounce);void list().catch(report);};
  if(revision!==site()?.site.revision&&!controller)void list().catch(report);else results();
  selection();
  host.ondragstart=e=>{const id=e.target.closest('[data-component-drag]')?.dataset.componentDrag;if(id&&items.some(item=>item.id===id)){
   drag={id,revision:site().site.revision};e.dataTransfer.setData(dragType,id);e.dataTransfer.effectAllowed='copy';
  }};
  host.ondragend=()=>{drag=null;};
 }
 function bindCanvas(doc){
  canvas=doc;
  for(const node of doc.querySelectorAll('['+marker+']')){
   node.dataset.observandaEditorEditable=node.getAttribute('contenteditable')??'absent';node.contentEditable='false';
  }
  const target=e=>{
   for(let node=e.target.closest?.(blocks);node&&doc.body.contains(node);node=node.parentElement){
    if(canPlace(node))return node;
   }
   return null;
  };
  const clearDrop=()=>{sheet.textContent='';};
  const dropAt=(node,e)=>e.clientY<node.getBoundingClientRect().top+node.getBoundingClientRect().height/2?'before':'after';
  const sheet=doc.createElement('style');sheet.dataset.observandaEditor='';doc.head.append(sheet);
  doc.addEventListener('dragover',e=>{if(!drag||!e.dataTransfer.types.includes(dragType))return;
   const node=target(e);clearDrop();if(!node&&e.target!==doc.body&&!e.target.matches?.('main'))return;
   e.preventDefault();e.dataTransfer.dropEffect='copy';if(node){
    const selector=layerPath(node).split('/').map(i=>':nth-child('+(Number(i)+1)+')').join('>');
    sheet.textContent='body>'+selector+'{box-shadow:inset 0 '+(dropAt(node,e)==='before'?'3px':'-3px')+' #315ac1!important}';
   }
  });
  doc.addEventListener('dragleave',e=>{if(!e.relatedTarget)clearDrop();});
  doc.addEventListener('drop',e=>{
   const held=drag;if(!held||!e.dataTransfer.types.includes(dragType))return;
   e.preventDefault();drag=null;
   if(held.id!==e.dataTransfer.getData(dragType)||held.revision!==site()?.site.revision)return;
   const node=target(e);clearDrop();if(!node&&e.target!==doc.body&&!e.target.matches?.('main'))return;
   void run(()=>place(held.id,node?dropAt(node,e):'end',node?layerPath(node):null));
  });
 }
 return {tabs,view,bind,bindCanvas,action,input,selection,pageChange,reset};
}
