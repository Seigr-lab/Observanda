const invisible='[hidden],[aria-hidden="true" i],script,style,template';

function targetDescription(node){
 let content,kind;
 if(node.matches('li[data-website-reference]')){kind='scienceReference';content=node.querySelector('cite');}
 else if(node.matches('math,figure[data-website-equation],figure.book-equation')){kind='referenceEquation';content=node.querySelector(':scope > figcaption');}
 else if(node.matches('figure')){kind='scienceFigure';content=node.querySelector(':scope > figcaption');}
 else if(node.matches('table')){kind='scienceTable';content=node.caption;}
 else if(node.matches('h1,h2,h3,h4,h5,h6')){kind='scienceHeading';content=node;}
 else kind='referenceAnchor';
 let label=node.getAttribute('aria-label')?.trim()||'';
 if(!label&&content&&!content.closest(invisible)){
  const walker=node.ownerDocument.createTreeWalker(content,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
   acceptNode:n=>n.nodeType===3?NodeFilter.FILTER_ACCEPT:n.matches(invisible)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP
  });
  for(let text=walker.nextNode();text&&label.length<160;text=walker.nextNode())label+=text.textContent.slice(0,160-label.length);
 }
 return {kind,label:label.replace(/\s+/g,' ').trim().slice(0,160)};
}

export function pageAnchors(doc,{describe=false}={}){
 const anchors=new Map();
 for(const node of doc.querySelectorAll('[id],a[name]')){
  const named=node.localName==='a'?node.getAttribute('name'):null;
  for(const id of new Set([node.id,named])){
   if(!id)continue;
   if(anchors.has(id)){anchors.set(id,'ambiguousLink');continue;}
   if(!doc.body.contains(node)||node.closest(invisible)){anchors.set(id,'brokenLink');continue;}
   anchors.set(id,describe?targetDescription(node):null);
  }
 }
 return anchors;
}

export function fragmentIssue(anchors,id){
 const item=anchors.get(id);
 if(!anchors.has(id))return id.toLowerCase()==='top'?null:'brokenLink';
 return typeof item==='string'?item:null;
}

export function targetHref(source,destination,id){
 if(source===destination)return '#'+encodeURIComponent(id);
 const from=source.split('/').slice(0,-1),to=destination.split('/');
 let common=0;
 while(common<from.length&&common<to.length-1&&from[common]===to[common])common++;
 return '../'.repeat(from.length-common)+to.slice(common).map(encodeURIComponent).join('/')+'#'+encodeURIComponent(id);
}
