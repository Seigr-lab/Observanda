// Keep the same live-region node in normal flow beside active bottom actions.
// Floating placement remains the default when the page has no docked controls.
export function noticeLayout(notice){
 const home=document.createComment('Global notice');notice.before(home);let observer=null,resize=null,frame=null,active=false;
 const visible=node=>node.isConnected&&!node.closest('[hidden],[inert]')&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
 function restore(){notice.removeAttribute('data-notice-docked');notice.style.removeProperty('max-height');notice.querySelector('.notice-message')?.removeAttribute('tabindex');if(home.parentNode&&notice.previousSibling!==home)home.after(notice);}
 function fit(host,modal){
  const value=notice.getBoundingClientRect(),bounds=host.getBoundingClientRect(),scale=value.width/notice.offsetWidth||1;
  const viewport=window.visualViewport?.height??innerHeight;
  const available=modal?Math.min(modal.clientHeight*scale,viewport):viewport-(bounds.height-value.height);
  let height=Math.max(0,Math.min(viewport*.35,available-8*scale))/scale;
  if(!modal&&bounds.bottom>viewport)height=Math.min(height,Math.max(0,value.height-(bounds.bottom-viewport))/scale);
  // A fit may shrink through consecutive layout passes, but cannot oscillate.
  const previous=Number.parseFloat(notice.style.maxHeight);if(Number.isFinite(previous))height=Math.min(height,previous);
  const limit=`${Math.floor(height)}px`;if(notice.style.maxHeight!==limit)notice.style.maxHeight=limit;
  const message=notice.querySelector('.notice-message');if(message)message.tabIndex=message.scrollHeight>message.clientHeight?0:-1;
 }
 function revealModal(modal,host){
  for(let parent=notice.parentElement;parent;parent=parent.parentElement){
   if(['auto','scroll'].includes(getComputedStyle(parent).overflowY)&&parent.scrollHeight>parent.clientHeight){
    const bounds=parent.getBoundingClientRect(),value=notice.getBoundingClientRect(),actions=host===modal?value:host.getBoundingClientRect();
    const top=bounds.top+parent.clientTop,bottom=top+parent.clientHeight;
    if(value.bottom>bottom)parent.scrollTop+=value.bottom-bottom;
    else if(actions.top<top&&value.bottom-actions.top<=parent.clientHeight)parent.scrollTop+=actions.top-top;
   }
   if(parent===modal)break;
  }
 }
 function place(reveal=false){
  frame=null;if(!active||notice.hidden)return;
  const modals=[...document.querySelectorAll('dialog:modal')].filter(visible);
  const modal=document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('dialog:modal')??modals.at(-1)??null;
  let host=modal?[...modal.querySelectorAll('.dialog-actions')].filter(visible).at(-1)??modal:null;
  if(!host){
   const height=window.visualViewport?.height??window.innerHeight,width=window.visualViewport?.width??window.innerWidth;
   const footers=[...document.querySelectorAll('.module-save,.section-save,.lab-type-settings>footer')].filter(node=>{
    if(!visible(node))return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    return ['sticky','fixed'].includes(style.position)&&style.bottom!=='auto'&&rect.top<height&&rect.bottom>0&&rect.left<width&&rect.right>0;
   });
   host=footers.reverse().find(node=>{const rect=node.getBoundingClientRect(),x=Math.max(0,Math.min(width-1,(rect.left+rect.right)/2)),y=Math.max(0,Math.min(height-1,rect.top+Math.min(2,rect.height/2)));return node.contains(document.elementsFromPoint(x,y).find(element=>!notice.contains(element)));})??null;
  }
  if(host){const moved=notice.parentNode!==host;notice.setAttribute('data-notice-docked','');if(moved){notice.style.removeProperty('max-height');host.append(notice);}fit(host,modal);if(modal&&(moved||reveal))revealModal(modal,host);}else restore();
 }
 function resizeViewport(){notice.style.removeProperty('max-height');schedule();}
 function schedule(){if(active&&frame===null)frame=requestAnimationFrame(()=>place());}
 function stop(){active=false;observer?.disconnect();resize?.disconnect();observer=resize=null;if(frame!==null)cancelAnimationFrame(frame);frame=null;window.removeEventListener('resize',resizeViewport);document.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',resizeViewport);window.visualViewport?.removeEventListener('scroll',schedule);}
 return {node:notice,
  show(){notice.hidden=false;notice.style.removeProperty('max-height');if(!active){active=true;observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','class','style','open']});resize=new ResizeObserver(schedule);resize.observe(notice);window.addEventListener('resize',resizeViewport);document.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',resizeViewport);window.visualViewport?.addEventListener('scroll',schedule);}place(true);},
  hide(){stop();notice.hidden=true;restore();},
  dispose(){stop();notice.hidden=true;restore();home.remove();}
 };
}
