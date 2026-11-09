const children=node=>Array.from(node.childNodes).filter(n=>!n.hasAttribute?.('data-observanda-editor'));
const managed='[data-observanda-source],[data-observanda-link],[data-website-instance],[data-website-feed],[data-website-source-gallery],[data-website-menu]';
export function websiteTextRuns(document,range){
 const container=range.commonAncestorContainer,walker=document.createTreeWalker(container,4);
 const texts=container.nodeType===3?[container]:[];
 for(let node=walker.nextNode();node;node=walker.nextNode())if(range.intersectsNode(node))texts.push(node);
 return texts.map(node=>({node,start:node===range.startContainer?range.startOffset:0,end:node===range.endContainer?range.endOffset:node.length})).filter(run=>run.end>run.start);
}
export function pinStyleText(document,range){
 const runs=websiteTextRuns(document,range);
 if(!runs.length||runs.some(r=>r.node.parentElement.closest(managed)))return null;
 const ids=new Set(),points=[];
 for(const {node,start,end} of runs){
  const path=[];for(let at=node;at!==document.body;at=at.parentNode)path.push(children(at.parentNode).indexOf(at));
  for(const name of node.parentElement.classList)if(name.startsWith('ow-token-'))ids.add(name.slice(9));
  points.push({path:path.reverse(),start,end,original:node.data});
 }
 return {label:range.toString().slice(0,90),ids:[...ids],points};
}
export function assignStyleText(document,pin,id,group,otherTokens){
 if(!pin||!['typography','color'].includes(group))return false;
 const runs=[];
 for(const point of pin.points){
  let node=document.body;for(const i of point.path){node=children(node)[i];if(!node)return false;}
  if(node.nodeType!==3||node.data!==point.original||node.parentElement.closest(managed))return false;
  runs.push({...point,node});
 }
 let changed=false;
 for(const {node,start,end} of runs){
  const parent=node.parentElement,owned=parent.tagName==='SPAN'&&parent.attributes.length===1&&parent.hasAttribute('class')&&parent.childNodes.length===1;
  const old=owned?[...parent.classList].filter(c=>c.startsWith('ow-token-')&&otherTokens.has(c.slice(9))):[];
  if(!id&&!old.length||old.length===1&&old[0]==='ow-token-'+id)continue;
  const after=end<node.length?node.splitText(end):null,text=start?node.splitText(start):node;
  if(old.length){
   if(start){const before=parent.cloneNode(false);before.append(node);parent.before(before);}
   if(after){const next=parent.cloneNode(false);next.append(after);parent.after(next);}
   parent.classList.remove(...old);if(id)parent.classList.add('ow-token-'+id);
   if(!parent.classList.length)parent.replaceWith(text);
  }else{
   const span=document.createElement('span');span.className='ow-token-'+id;text.replaceWith(span);span.append(text);
  }
  changed=true;
 }
 return changed;
}
