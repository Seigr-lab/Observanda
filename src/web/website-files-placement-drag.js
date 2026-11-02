const dragType='application/x-observanda-publication-entry';

// Transfer only a one-use token between the library and the same editor's frame.
// The store rechecks both the source grant and the destination revision on write.
export function websitePlacementDrag({site,available,place,t}){
 let docked=false,drag=null,line=null;
 function clearLine(){line?.remove();line=null;}
 function reset(){docked=false;drag=null;clearLine();}
 function paint(dialog){
  const toggle=dialog.querySelector('[data-picker-dock]');
  if(!toggle)return;
  function display(){
   if(docked===dialog.matches(':modal')){
    dialog.close();if(docked)dialog.show();else dialog.showModal();
   }
   dialog.toggleAttribute('data-placement-dock',docked);
   toggle.textContent=t(docked?'pickerUndock':'pickerDock');
   toggle.setAttribute('aria-pressed',String(docked));
   if(docked&&!dialog.querySelector('.website-drag-instructions')){
    const hint=dialog.ownerDocument.createElement('p');
    hint.className='website-drag-instructions';hint.textContent=t('pickerDropHelp');dialog.querySelector('header').after(hint);
   }
   if(!docked)dialog.querySelector('.website-drag-instructions')?.remove();
  }
  display();
  toggle.onclick=()=>{docked=!docked;drag=null;clearLine();display();toggle.focus();};
  const close=()=>dialog.querySelector('[data-action="website-files-picker-close"]')?.click();
  dialog.onkeyup=e=>{if(docked&&e.key==='Escape'){e.preventDefault();close();}};
  dialog.ondragstart=e=>{
   const row=e.target.closest('[data-picker-drag-handle]')?.closest('[data-picker-row]'),page=site();
   if(!docked||!row||!page||!available()){e.preventDefault();return;}
   drag={token:crypto.randomUUID(),sourceId:row.dataset.pickerRow,sourceRevision:row.dataset.pickerRevision,
    siteId:page.site.id,revision:page.site.revision,path:page.path};
   e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData(dragType,drag.token);
  };
  dialog.ondragend=()=>{drag=null;clearLine();};
  // Opening a title in the compact list restores its full details and placement controls.
  for(const title of dialog.querySelectorAll('[data-action="website-files-picker-select"]')){
   title.onclick=()=>{if(docked){docked=false;display();}};
  }
 }
 function bindCanvas(doc,frame){
  function insertion(e){
   const parent=doc.querySelector('main:not([hidden])')??doc.body;
   const blocks=[...parent.children].filter(n=>!n.matches('script,style,link,[data-observanda-editor]'));
   let target=e.target;
   while(target&&target.parentElement!==parent)target=target.parentElement;
   if(!blocks.includes(target)&&e.target!==parent&&e.target!==doc.body&&e.target!==doc.documentElement)return null;
   let index=blocks.indexOf(target);
   if(index<0)index=blocks.findIndex(el=>e.clientY<el.getBoundingClientRect().bottom);
   if(index<0)index=blocks.length;
   const bounds=blocks[index]?.getBoundingClientRect();
   if(bounds&&e.clientY>=bounds.top+bounds.height/2)index++;
   const y=blocks[index]?.getBoundingClientRect().top??blocks.at(-1)?.getBoundingClientRect().bottom??parent.getBoundingClientRect().top;
   return {position:index===blocks.length?'end':{before:index},y};
  }
  const valid=()=>{const page=site();return drag&&available()&&frame.isConnected&&page?.site.id===drag.siteId&&page.site.revision===drag.revision&&page.path===drag.path;};
  doc.addEventListener('dragover',e=>{
   if(!drag||!e.dataTransfer.types.includes(dragType))return;
   e.preventDefault();const dest=valid()&&insertion(e);
   if(!dest){e.dataTransfer.dropEffect='none';clearLine();return;}
   e.dataTransfer.dropEffect='copy';
   if(!line){line=frame.ownerDocument.createElement('div');line.className='website-placement-line';line.setAttribute('aria-hidden','true');frame.ownerDocument.body.append(line);}
   const bounds=frame.getBoundingClientRect();
   Object.assign(line.style,{left:bounds.left+'px',width:frame.clientWidth+'px',top:Math.min(bounds.bottom-3,Math.max(bounds.top,bounds.top+dest.y))+'px'});
  });
  doc.addEventListener('dragleave',e=>{if(!e.relatedTarget)clearLine();});
  doc.addEventListener('drop',e=>{
   if(!drag||!e.dataTransfer.types.includes(dragType))return;
   e.preventDefault();const dest=valid()&&insertion(e),source=drag;drag=null;clearLine();
   if(dest&&e.dataTransfer.getData(dragType)===source.token)place({sourceId:source.sourceId,sourceRevision:source.sourceRevision,position:dest.position});
  });
 }
 return {paint,reset,bindCanvas};
}
