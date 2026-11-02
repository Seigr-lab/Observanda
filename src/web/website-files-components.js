import {websiteTextLinks} from './website-files-text-link.js';

const marker='data-website-instance',dragType='application/x-observanda-component';
function nodeAt(doc,path){
 if(typeof path!=='string'||!/^\d+(?:\/\d+)*$/.test(path))return null;
 let node=doc.body;for(const number of path.split('/'))node=node?.children[Number(number)];
 return node;
}
function pathOf(node){
 const steps=[];for(;node?.parentElement&&node!==node.ownerDocument.body;node=node.parentElement)steps.unshift(Array.prototype.indexOf.call(node.parentElement.children,node));
 return steps.join('/');
}
export function websiteFilesComponents({request,tr,esc,site,selected,save,adopt,render,run}){
 let opened=false,items=[],query='',name='',position='after',offset=0,next=null,revision=null,drag=null,canvas=null,dialog=null,epoch=0;
 const button=(key,op,extra='')=>'<button type="button" class="button" data-action="website-files-component-'+op+'" '+extra+'>'+esc(tr(key))+'</button>';
 const local=()=>({siteId:site().site.id,expectedRevision:site().site.revision,path:site().path});
 function reset(){epoch++;dialog?.close();dialog=null;canvas=null;opened=false;items=[];query=name='';offset=0;next=revision=drag=null;}
 function closeDialog(){dialog?.close();dialog=null;}
 async function list(start=0){
  const pin=local(),token=++epoch,value=await request('components/list',{...pin,offset:start,query});
  if(token!==epoch||site()?.site.id!==pin.siteId||site().site.revision!==value.revision)return;
  offset=start;next=value.next;revision=value.revision;items=value.items;opened=true;render();
 }
 function view(){
  const label=key=>esc(tr(key));
  let content=button('componentBrowse','browse');
  if(opened)content='<p>'+label('componentHelp')+'</p><label>'+label('componentName')+'<input maxlength="100" data-component-field="name" value="'+esc(name)+'"></label>'+button('componentCreate','create')+
   button('componentDetach','detach')+'<label>'+label('componentSearch')+'<input type="search" maxlength="100" data-component-field="query" value="'+esc(query)+'"></label>'+button('pickerFind','search')+
   '<label>'+label('pickerPosition')+'<select data-component-field="position">'+[['before','componentBefore'],['after','componentAfter'],['end','pickerEnd']].map(([v,k])=>'<option value="'+v+'" '+(v===position?'selected':'')+'>'+label(k)+'</option>').join('')+'</select></label>'+
   (revision!==site()?.site.revision?button('reopen','search'):items.length?'<ul>'+items.map(item=>'<li draggable="true" data-component-drag="'+esc(item.id)+'"><strong>'+esc(item.name)+'</strong>'+button('componentInsert','insert','data-component="'+esc(item.id)+'"')+button('componentEdit','edit','data-component="'+esc(item.id)+'"')+'</li>').join('')+'</ul>':'<p>'+label('componentEmpty')+'</p>')+
   (offset?button('pickerPrevious','previous'):'')+(next!==null?button('pickerNext','next'):'')+button('componentClose','close');
  return '<section class="panel website-files-components" data-website-components><h2>'+label('componentTitle')+'</h2>'+content+'</section>';
 }
 function input(el){
  if(!el?.dataset?.componentField)return false;
  if(el.dataset.componentField==='name')name=el.value;
  if(el.dataset.componentField==='query')query=el.value;
  if(el.dataset.componentField==='position')position=el.value;
  return true;
 }
 async function write(op,options){
  const pin=local(),token=epoch,result=await request('components/'+op,{...pin,...options});
  if(token!==epoch||site()?.site.id!==pin.siteId||site().site.revision!==pin.expectedRevision)return;
  closeDialog();adopt(result);await list(0);
 }
 async function place(id,where,blockPath){
  if(where!=='end'&&!blockPath)throw Error(tr('componentSelect'));
  await save();await write('insert',{component:id,position:where,blockPath});
 }
 function editor(value,pin){
  closeDialog();const host=document.createElement('dialog');dialog=host;host.className='website-author-dialog';host.setAttribute('aria-label',tr('componentEdit'));
  host.innerHTML='<h2>'+esc(tr('componentEdit'))+'</h2><p>'+esc(tr('componentApplyHelp'))+'</p><label>'+esc(tr('componentName'))+'<input data-main-name maxlength="100"></label>'+
   '<div class="inline-actions" data-main-links></div><iframe data-main-canvas sandbox="allow-same-origin" title="'+esc(tr('componentEdit'))+'"></iframe><details><summary>'+esc(tr('html'))+'</summary><label>'+esc(tr('componentMarkup'))+'<textarea data-main-source rows="7"></textarea></label></details>'+
   '<p role="alert" data-main-error></p><div class="inline-actions"><button type="button" data-main-apply>'+esc(tr('componentApply'))+'</button><button type="button" data-main-cancel>'+esc(tr('cancel'))+'</button></div>';
  const title=host.querySelector('[data-main-name]'),source=host.querySelector('textarea'),frame=host.querySelector('iframe'),apply=host.querySelector('[data-main-apply]');
  title.value=value.name;source.value=value.html;
  // Only admitted server markup is loaded into the interactive frame.
  // User-entered HTML stays inert until the server validates the new main.
  const linkTools=host.querySelector('[data-main-links]');
  let code=false;source.oninput=()=>{code=true;frame.inert=true;linkTools.inert=true;};
  frame.onload=()=>{
   const doc=frame.contentDocument;if(!doc||!host.isConnected)return;
   const fragment=doc.createElement('template');fragment.innerHTML=value.html;
   doc.body.replaceChildren(fragment.content);doc.body.contentEditable='true';
   const style=doc.createElement('style');style.textContent=site()?.css??'';doc.head.append(style);
   doc.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
   doc.addEventListener('drop',e=>e.preventDefault());
   doc.addEventListener('paste',e=>{e.preventDefault();doc.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
   doc.body.oninput=()=>{if(!code)source.value=doc.body.innerHTML;};
   websiteTextLinks({document:doc,tools:linkTools,t:tr,listen:(node,type,cb)=>node.addEventListener(type,cb),
    safeRange:range=>!code&&host.open&&frame.contentDocument===doc&&doc.body.contains(range.commonAncestorContainer),
    beforeChange:()=>{},change:()=>{source.value=doc.body.innerHTML;}});
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
  if(op==='close'){reset();render();return true;}
  if(op==='browse'||op==='search'){await list();return true;}
  if(op==='next'||op==='previous'){await list(op==='next'?next:Math.max(0,offset-12));return true;}
  const id=el.dataset.component,path=selected(),instance=nodeAt(canvas??document,path)?.closest('['+marker+']')?.getAttribute(marker);
  if(op==='insert')await place(id,position,path);
  if(op==='create'){if(!path||!name.trim())throw Error(tr('componentSelect'));await save();await write(op,{name,blockPath:path});}
  if(op==='detach'){if(!instance)throw Error(tr('componentSelectInstance'));await save();await write(op,{instance});}
  if(op==='edit'){await save();const pin=local(),value=await request('components/main',{...pin,component:id});if(site()?.site.revision===value.revision&&site().site.id===pin.siteId)editor(value,pin);}
  return true;
 }
 function bind(){
  const host=document.querySelector('[data-website-components]');if(!host)return;
  host.ondragstart=e=>{const id=e.target.closest('[data-component-drag]')?.dataset.componentDrag;if(id&&items.some(item=>item.id===id)){
   drag={id,revision:site().site.revision};e.dataTransfer.setData(dragType,id);e.dataTransfer.effectAllowed='copy';
  }};
  host.ondragend=()=>{drag=null;};
  const field=host.querySelector('[data-component-field="query"]');
  if(field)field.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();host.querySelector('[data-action="website-files-component-search"]').click();}};
 }
 function bindCanvas(doc){
  canvas=doc;
  for(const node of doc.querySelectorAll('['+marker+']')){
   node.dataset.observandaEditorEditable=node.getAttribute('contenteditable')??'absent';node.contentEditable='false';
  }
  const target=e=>e.target.closest('['+marker+'],section,article,aside,div,figure,details,table,h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,pre,hr,img');
  doc.addEventListener('dragover',e=>{if(drag&&e.dataTransfer.types.includes(dragType)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  doc.addEventListener('drop',e=>{
   const held=drag;if(!held||!e.dataTransfer.types.includes(dragType))return;
   e.preventDefault();drag=null;
   if(held.id!==e.dataTransfer.getData(dragType)||held.revision!==site()?.site.revision)return;
   const node=target(e),rect=node?.getBoundingClientRect(),where=rect?(e.clientY<rect.top+rect.height/2?'before':'after'):'end';
   void run(()=>place(held.id,where,node?pathOf(node):null));
  });
 }
 return {view,bind,bindCanvas,action,input,reset};
}
