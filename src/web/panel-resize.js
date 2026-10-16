import {panelSpan} from './dashboard-model.js';
// A resize is a cancellable gesture. Persistence stays with the preference draft owner.
export function bindPanelResize(root,{commit,announce}){
 if(!root)return ()=>{};
 const controller=new AbortController(),options={signal:controller.signal};let gesture=null;
 const widths=['quarter','standard','half','wide','full'];
 function end(apply){if(!gesture)return;const g=gesture;gesture=null;g.panel.style.cssText=g.original;if(apply)commit(g.id,g.width,g.height);else announce('Resize cancelled.');}
 root.addEventListener('pointerdown',e=>{const handle=e.target.closest('[data-panel-resize]');if(!handle||e.button!==0)return;e.preventDefault();handle.focus();handle.setPointerCapture(e.pointerId);const panel=handle.closest('.dashboard-panel'),box=panel.getBoundingClientRect();gesture={id:handle.dataset.panelResize,panel,original:panel.style.cssText,startWidth:box.width,startHeight:box.height,width:handle.dataset.width,height:Number(handle.dataset.height),x:e.clientX,y:e.clientY,pointer:e.pointerId,moved:false};},options);
 root.addEventListener('pointermove',e=>{const g=gesture;if(!g||g.pointer!==e.pointerId)return;const dx=e.clientX-g.x,dy=e.clientY-g.y;if(!g.moved&&Math.hypot(dx,dy)<5)return;g.moved=true;const fraction=(g.startWidth+dx)/root.clientWidth*12;g.width=widths.reduce((a,b)=>Math.abs(panelSpan(b)-fraction)<Math.abs(panelSpan(a)-fraction)?b:a);g.height=Math.max(240,Math.min(1200,Math.round((g.startHeight+dy)/20)*20));g.panel.style.setProperty('--panel-span',panelSpan(g.width));g.panel.style.setProperty('--panel-height',g.height+'px');},options);
 root.addEventListener('pointerup',e=>{if(gesture?.pointer===e.pointerId)end(gesture.moved);},options);
 root.addEventListener('pointercancel',()=>end(false),options);
 root.addEventListener('lostpointercapture',()=>end(false),options);
 root.addEventListener('keydown',e=>{const h=e.target.closest('[data-panel-resize]');if(!h)return;if(e.key==='Escape'&&gesture){e.preventDefault();end(false);return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();let width=h.dataset.width,height=Number(h.dataset.height);if(e.key==='Home')height=0;else if(e.key==='ArrowLeft'||e.key==='ArrowRight')width=widths[Math.max(0,Math.min(widths.length-1,widths.indexOf(width)+(e.key==='ArrowLeft'?-1:1)))];else height=Math.max(240,Math.min(1200,(height||Math.round(h.closest('.dashboard-panel').getBoundingClientRect().height/20)*20)+(e.key==='ArrowUp'?-20:20)));commit(h.dataset.panelResize,width,height);},options);
 return ()=>{end(false);controller.abort();};
}
