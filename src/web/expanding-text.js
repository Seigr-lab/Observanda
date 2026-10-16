// Shared textarea behaviour across records, dialogs, preferences and composers.
// ResizeObserver follows font/layout/width changes; content stays in page flow.
export function expandingText(root=document){
  const known=new Map(),pending=new Set();
  let frame=null;
  const schedule=element=>{if(element?.matches?.('textarea'))pending.add(element);if(frame===null)frame=requestAnimationFrame(flush);};
  function fit(element){
    if(!element.isConnected||!element.getClientRects().length)return;
    const style=getComputedStyle(element),border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
    const positions=[];
    for(let node=element.parentElement;node;node=node.parentElement)if(node.scrollTop||node.scrollLeft)positions.push([node,node.scrollLeft,node.scrollTop]);
    element.style.height='auto';
    const height=element.scrollHeight+(style.boxSizing==='border-box'?border:-(parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)));
    element.style.height=Math.ceil(height)+'px';
    // A textarea never owns vertical scrolling; caret movement scrolls the page.
    element.scrollTop=0;
    // Measuring at intrinsic height must not temporarily clamp the document's
    // scroll position while the field is collapsed for measurement.
    for(const [node,left,top] of positions){if(node.scrollTop!==top)node.scrollTop=top;if(node.scrollLeft!==left)node.scrollLeft=left;}
  }
  function flush(){frame=null;for(const element of pending)fit(element);pending.clear();}
  const resize=new ResizeObserver(entries=>{
    for(const {target,contentRect} of entries){
      if(known.get(target)!==contentRect.width){known.set(target,contentRect.width);schedule(target);}
    }
  });
  function scan(node){
    if(node.nodeType!==1&&node!==document)return;
    const elements=[...(node.matches?.('textarea')?[node]:[]),...node.querySelectorAll('textarea')];
    for(const element of elements){if(!known.has(element)){known.set(element,-1);resize.observe(element);}schedule(element);}
    for(const element of known.keys())if(!element.isConnected){resize.unobserve(element);known.delete(element);pending.delete(element);}
  }
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='childList'){record.addedNodes.forEach(scan);if(record.target.matches?.('textarea'))schedule(record.target);}
      else scan(record.target);
    }
  });
  observer.observe(root===document?document.documentElement:root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','rows']});
  root.addEventListener('input',event=>schedule(event.target),true);
  root.addEventListener('change',event=>schedule(event.target),true);
  document.fonts?.ready.then(()=>scan(root));
  document.fonts?.addEventListener('loadingdone',()=>scan(root));
  document.addEventListener('observanda:interface-layout',()=>scan(root));
  window.addEventListener('resize',()=>scan(root));
  window.addEventListener('beforeprint',()=>{for(const element of known.keys())fit(element);});
  scan(root);
  return {refresh:()=>scan(root)};
}
