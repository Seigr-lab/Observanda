// Folder navigation is transient; choosing a folder changes only the calling field.
export function folderPickerUI({api,esc,field,showDialog,capabilities}) {
  let nativePending=false,target,returnDialog,current,history=[],position=-1,query='',showHidden=false,request=0,timer,pending;
  const folderIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3z"/></svg>';
  const button=(label,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${label}</button>`;
  function message(text){const el=document.querySelector('[data-folder-error]');if(el){el.textContent=text;el.hidden=!text;}}
  function restore(use=false){
    request++;clearTimeout(timer);pending?.abort();pending=null;
    if(use&&current){target.value=current.folder;target.dispatchEvent(new Event('input',{bubbles:true}));}
    const dialog=document.querySelector('#dialog');
    if(returnDialog){dialog.replaceChildren(returnDialog);returnDialog=null;}else dialog.close();
    if(target?.isConnected)target.focus();target=null;
  }
  async function browse(path,{offset=0,travel=null,filter=false}={}) {
    if(!filter){clearTimeout(timer);query='';}
    const ticket=++request,search=query,hidden=showHidden;pending?.abort();const controller=new AbortController();pending=controller;
    const searchFocused=document.activeElement?.id==='folder-search';
    const shell=document.querySelector('.folder-browser');shell?.setAttribute('aria-busy','true');
    for(const control of shell?.querySelectorAll('button,input')??[]) {
      if(control.dataset.action==='storage-browse-cancel'||filter&&control.id==='folder-search')continue;
      if(!control.hasAttribute('data-folder-disabled'))control.dataset.folderDisabled=String(control.disabled);
      control.disabled=true;
    }
    try {
      const result=await api('/api/storage/browse',{path,offset,search,hidden},{signal:controller.signal});
      if(ticket!==request||!target||filter&&search!==query)return;
      if(travel!==null)position=travel;
      else if(current?.folder!==result.folder){history=history.slice(0,position+1);history.push(result.folder);position=history.length-1;}
      query=search;current=result;
      showDialog(`<div class="folder-browser"><h2 id="dialog-title">${capabilities()?.mode==='server'?'Choose a folder on the server':'Choose a folder on this computer'}</h2>
        <div class="folder-toolbar"><div class="folder-travel">${button('&larr;','storage-browse-back',`aria-label="Back" ${position<=0?'disabled':''}`)}${button('&rarr;','storage-browse-forward',`aria-label="Forward" ${position>=history.length-1?'disabled':''}`)}${button('&uarr;','storage-browse-up',`aria-label="Up one folder" ${result.folder===result.parent?'disabled':''}`)}</div>
        <nav class="folder-breadcrumbs" aria-label="Folder location">${result.breadcrumbs.map((crumb,i)=>`<button type="button" data-action="storage-browse-at" data-path="${esc(crumb.path)}" ${i===result.breadcrumbs.length-1?'aria-current="location"':''}>${esc(crumb.name)}</button>`).join('<span aria-hidden="true">&rsaquo;</span>')}</nav>
        ${button('New folder','storage-browse-new')}</div>
        <div class="folder-explorer"><nav class="folder-places" aria-label="Places"><h3>Places</h3>${result.places.map(place=>`<button type="button" data-action="storage-browse-at" data-path="${esc(place.path)}" ${place.path===result.folder?'aria-current="location"':''}>${folderIcon}<span>${esc(place.name)}</span></button>`).join('')}</nav>
        <section class="folder-content" aria-label="Folders"><div class="folder-search-bar"><input id="folder-search" type="search" aria-label="Search this folder" placeholder="Search folders" value="${esc(query)}"><label class="checkbox"><input id="folder-hidden" type="checkbox" ${hidden?'checked':''}>Hidden folders</label></div>
        <form id="storage-folder-new" class="folder-new" hidden>${field('New folder name','<input name="name" required maxlength="160" autocomplete="off">')}<div class="inline-actions">${button('Cancel','storage-browse-new-cancel')}<button class="button primary" type="submit">Create folder</button></div></form>
        ${result.placesIncomplete?'<p role="status">Some drives did not respond. Available folders are shown; you can enter another path below.</p>':''}
        <p data-folder-error class="folder-error" role="alert" hidden></p>
        <div class="folder-list">${result.folders.map(f=>`<button type="button" class="folder-row" data-action="storage-browse-at" data-path="${esc(f.path)}">${folderIcon}<span>${esc(f.name)}</span><span aria-hidden="true">&rsaquo;</span></button>`).join('')||`<p class="folder-empty">${query?'No matching folders':'No folders here'}</p>`}</div>
        <div class="folder-pagination"><span>${result.total} ${result.total===1?'folder':'folders'}</span>${result.offset?button('Previous','storage-browse-page',`data-offset="${Math.max(0,result.offset-200)}"`):''}${result.hasMore?button('Next','storage-browse-page',`data-offset="${result.offset+200}"`):''}</div></section></div>
        <details class="folder-address"><summary>Go to a path or network share</summary><form id="storage-browse-form">${field('Folder or mounted share',`<input name="path" value="${esc(result.folder)}" required autocomplete="off" spellcheck="false">`)}<button class="button" type="submit">Go to folder</button></form></details>
        <footer class="folder-footer"><span class="folder-selection">${folderIcon}<strong>${esc(result.breadcrumbs.at(-1).name)}</strong></span><div class="inline-actions">${button('Cancel','storage-browse-cancel')}<button class="button primary" type="button" data-action="storage-browse-use">Use this folder</button></div></footer></div>`);
      if(filter&&searchFocused)document.querySelector('#folder-search').focus();
      else document.querySelector('.folder-breadcrumbs [aria-current]')?.focus();
    } catch(error){if(ticket!==request)return;message(error.message??'This folder could not be opened.');throw error;}
    finally{if(ticket===request){
      pending=null;
      document.querySelector('.folder-browser')?.removeAttribute('aria-busy');
      for(const control of document.querySelectorAll('[data-folder-disabled]')){control.disabled=control.dataset.folderDisabled==='true';delete control.dataset.folderDisabled;}
    }}
  }
  async function chooseNative(el){
    if(nativePending)return;
    const input=document.getElementById(el.dataset.target),form=input.closest('form'),original=input.value;
    const controls=[...(form?.querySelectorAll('button,input,select,textarea')??[el])].map(control=>[control,control.disabled]);
    const label=el.textContent;nativePending=true;if(form)form.dataset.busy='true';
    for(const [control] of controls)control.disabled=true;
    el.textContent='Selecting folder...';el.setAttribute('aria-busy','true');
    try{
      const result=await api('/api/storage/pick',{path:original});
      if(!result.cancelled&&input.isConnected&&input.value===original){input.value=result.folder;input.dispatchEvent(new Event('input',{bubbles:true}));}
    }finally{
      nativePending=false;if(form)delete form.dataset.busy;
      for(const [control,disabled] of controls)control.disabled=disabled;
      el.textContent=label;el.removeAttribute('aria-busy');if(input.isConnected)input.focus();
    }
  }
  async function action(el){
    const name=el.dataset.action;
    if(name==='storage-browse'){
      if(capabilities()?.mode!=='server'){await chooseNative(el);return true;}
      target=document.getElementById(el.dataset.target);const dialog=document.querySelector('#dialog');
      returnDialog=dialog.open?document.createDocumentFragment():null;if(returnDialog)while(dialog.firstChild)returnDialog.append(dialog.firstChild);
      current=null;history=[];position=-1;query='';showHidden=false;
      const initialPath=target.value;
      showDialog('<div class="folder-browser"><h2 id="dialog-title">Choose a folder on the server</h2><p role="status">Loading folders...</p><p data-folder-error class="folder-error" role="alert" hidden></p><div class="dialog-actions">'+button('Cancel','storage-browse-cancel')+'</div></div>');
      try{await browse(initialPath);}catch{if(!target)return true;try{await browse('');}catch(error){if(!target)return true;restore();throw error;}}return true;
    }
    if(!name.startsWith('storage-browse-'))return false;
    if(name==='storage-browse-use'||name==='storage-browse-cancel'){restore(name==='storage-browse-use');return true;}
    if(name==='storage-browse-new'||name==='storage-browse-new-cancel'){
      const form=document.querySelector('#storage-folder-new');form.hidden=name.endsWith('-cancel');if(!form.hidden)form.elements.name.focus();else message('');return true;
    }
    try {
      if(name==='storage-browse-at')await browse(el.dataset.path);
      if(name==='storage-browse-up')await browse(current.parent);
      if(name==='storage-browse-back'&&position>0)await browse(history[position-1],{travel:position-1});
      if(name==='storage-browse-forward'&&position<history.length-1)await browse(history[position+1],{travel:position+1});
      if(name==='storage-browse-page')await browse(current.folder,{offset:Number(el.dataset.offset),filter:true});
    }catch{} // The current location and error remain in the dialog.
    return true;
  }
  function input(el){
    if(!['folder-search','folder-hidden'].includes(el.id))return false;
    if(el.id==='folder-search')query=el.value;else showHidden=el.checked;
    clearTimeout(timer);timer=setTimeout(()=>browse(current.folder,{filter:true}).catch(()=>{}),150);return true;
  }
  async function submit(form,data){
    if(!['storage-browse-form','storage-folder-new'].includes(form.id))return false;
    try{
      if(form.id==='storage-browse-form')await browse(data.get('path'));
      else {const result=await api('/api/storage/folder',{parent:current.folder,name:data.get('name')});await browse(result.folder);}
    }catch(error){message(error.message??'The folder could not be opened.');}
    return true;
  }
  return {action,input,submit};
}
