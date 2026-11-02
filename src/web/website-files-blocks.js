export const blockTypes=['paragraph','heading','section','columns','quote','table','equationEdit','details','divider','actionLink','gallery'];

export function duplicateBlock(node){
 const copy=node.cloneNode(true),ids=new Map();
 for(const el of [copy,...copy.querySelectorAll('[id]')]){
  if(!el.id)continue;const id='section-'+crypto.randomUUID();ids.set(el.id,id);el.id=id;
 }
 for(const el of [copy,...copy.querySelectorAll('[href],[for],[aria-labelledby],[aria-describedby],[aria-controls],[headers]')]){
  const href=el.getAttribute('href');if(href?.startsWith('#')&&ids.has(href.slice(1)))el.setAttribute('href','#'+ids.get(href.slice(1)));
  for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls','headers']){
   if(el.hasAttribute(attr))el.setAttribute(attr,el.getAttribute(attr).split(/\s+/).map(id=>ids.get(id)??id).join(' '));
  }
 }
 node.after(copy);return copy;
}

export function createBlock(doc,type,t) {
  const el=(tag,text)=>{const node=doc.createElement(tag);if(text)node.textContent=text;return node;};
  if(type==='paragraph')return el('p',t('paragraph'));
  if(type==='heading')return el('h2',t('heading'));
  if(type==='divider')return el('hr');
  if(type==='quote')return el('blockquote',t('quote'));
  if(type==='details'){
    const node=el('details');node.append(el('summary',t('heading')),el('p',t('paragraph')));return node;
  }
  if(type==='table'){
    const node=el('table');node.createCaption().textContent=t('table');
    const head=node.createTHead().insertRow(),body=node.createTBody().insertRow();
    for(let i=0;i<2;i++){const cell=el('th',t('column')+' '+(i+1));cell.scope='col';head.append(cell);body.insertCell().textContent=t('cell');}
    return node;
  }
  if(type==='gallery'){const node=el('section');node.append(el('h2',t('gallery')));const grid=el('div');grid.className='site-gallery gallery-columns-3';grid.dataset.imageGallery='';node.append(grid);return node;}
  const node=el('section');
  if(type==='columns'){
    node.className='website-columns';for(let i=0;i<2;i++){const column=el('section');column.append(el('h2',t('heading')),el('p',t('paragraph')));node.append(column);}
  }else node.append(el('h2',t('heading')),el('p',t('paragraph')));
  return node;
}
