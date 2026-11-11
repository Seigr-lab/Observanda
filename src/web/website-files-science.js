const owned='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-website-instance],[data-website-region],[data-observanda-editor],[data-website-feed]';
const bibliography='[data-website-bibliography]',entry='li[data-website-reference]';
const objects='figure,table,h1,h2,h3,h4,h5,h6,'+entry;
const prose='p,li,dt,dd,h1,h2,h3,h4,h5,h6,td,th,figcaption,blockquote';
const element=node=>node?.nodeType===1?node:node?.parentElement;
const writable=node=>!!node?.isConnected&&!node.closest(owned+',header,footer,nav,[hidden]')&&!node.querySelector(owned);
const capOf=target=>target.querySelector(':scope > '+(target.matches('table')?'caption':'figcaption'));
const isReference=node=>node.matches(entry)&&node.parentElement?.matches('ol')&&node.parentElement.parentElement?.matches(bibliography);
const kind=node=>isReference(node)?'scienceReference':node.matches('figure')?'scienceFigure':node.matches('table')?'scienceTable':'scienceHeading';
function textOf(node){
 if(isReference(node))return node.querySelector('cite')?.textContent;
 if(node.matches('figure,table'))return capOf(node)?.textContent||node.querySelector('img[alt]')?.alt;
 return node.textContent;
}
function uniqueId(node){
 if(!node.id)return true;
 return node.ownerDocument.querySelectorAll('#'+CSS.escape(node.id)).length===1;
}
function idFor(node){
 if(node.id)return node.id;
 const prefix=isReference(node)?'ref':node.matches('figure')?'fig':node.matches('table')?'tbl':'sec';
 let id;do{id=prefix+'-'+crypto.randomUUID();}while(node.ownerDocument.getElementById(id));
 return id;
}
function address(value){
 let text=value.trim();if(!text)return '';
 if(/^10\.\d{4,9}\/\S+$/i.test(text))text='https://doi.org/'+text;
 if(!/^https:\/\//i.test(text)||/[\\\s\u0000-\u001f]/.test(text))return null;
 try{const url=new URL(text);
  if(url.username||url.password||url.origin===location.origin||!url.hostname.includes('.')||/^localhost\.|^127\./i.test(url.hostname)||/^\/api(?:\/|$)/i.test(url.pathname))return null;
  return url.href;
 }catch{return null;}
}
function citationRange(range,document){
 if(!range||!range.startContainer.isConnected||!range.endContainer.isConnected||range.startContainer.ownerDocument!==document)return false;
 const start=element(range.startContainer),end=element(range.endContainer),block=start?.closest(prose);
 if(!block||block!==end?.closest(prose)||start.closest('a,'+bibliography)||end.closest('a,'+bibliography)||!writable(block))return false;
 for(const content of block.querySelectorAll('a,img,video,audio,figure,math,svg,[contenteditable=false]'))if(range.intersectsNode(content))return false;
 return true;
}
function insertionRange(selection){
 const range=selection.getRangeAt(0).cloneRange(),link=element(range.startContainer)?.closest('a');
 if(!range.collapsed||!writable(link))return range;
 // Chromium can represent End at the end of the link's last text node.
 // Insert adjacent to it when the caret is at its exact outer boundary.
 const start=range.startContainer,length=start.nodeType===3?start.length:start.childNodes.length,after=range.startOffset===length;
 if(!after&&range.startOffset!==0)return range;
 for(let node=start;node!==link;node=node.parentNode)if(after?node.nextSibling:node.previousSibling)return range;
 if(after)range.setStartAfter(link);else range.setStartBefore(link);
 range.collapse(true);return range;
}
const maxResults=40;
export function websiteScientificReferences({document,host,t,listen,beforeChange,change,selected}){
 const outer=host.ownerDocument;
 function make(tag,text){const el=outer.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
 const panel=make('details');panel.className='website-science-inspector';panel.append(make('summary',t('sciencePanel')));host.append(panel);
 function label(name,el){const row=make('div'),field=make('label',t(name));el.id='science-'+crypto.randomUUID();field.htmlFor=el.id;row.append(field,el);panel.append(row);return row;}
 function input(name,max){const el=make('input');el.maxLength=max;return [el,label(name,el)];}
 function option(select,value,text){const o=make('option',text);o.value=value;select.append(o);}
 const mode=make('select');for(const key of ['scienceCaption','scienceReference','scienceLink'])option(mode,key,t(key));label('scienceTask',mode);
 const [filter]=input('scienceSearch',200),choices=make('select');label('scienceTarget',choices);
 const [caption,captionRow]=input('scienceCaptionText',1200),[authors,authorRow]=input('scienceAuthors',600),[year,yearRow]=input('scienceYear',80);
 const [title,titleRow]=input('scienceTitle',1200),[url,urlRow]=input('scienceURL',2000),[description,descriptionRow]=input('scienceLinkText',600);
 const status=make('p'),hint=make('p'),apply=make('button'),remove=make('button',t('scienceRemove'));
 status.setAttribute('role','status');apply.type=remove.type='button';panel.append(hint,apply,remove,status);
 let rows=[],shown=[],range=null,lastClicked=null;
 function capture(){
  const selection=document.defaultView.getSelection();if(!selection?.rangeCount)return;
  const value=insertionRange(selection);range=citationRange(value,document)?value:null;
 }
 function message(key){status.textContent=t(key);}
 function selectedTarget(){return shown[Number(choices.value)]??null;}
 function fields(){
  const task=mode.value,target=choices.value===''?null:selectedTarget(),bib=task==='scienceReference',cap=task==='scienceCaption';
  captionRow.hidden=!cap;descriptionRow.hidden=cap||bib;for(const f of [authorRow,yearRow,titleRow,urlRow])f.hidden=!bib;
  remove.hidden=!bib||!target;apply.textContent=t(cap?'scienceSaveCaption':bib?'scienceSaveReference':'scienceInsertLink');
  hint.textContent=cap?'':bib?t('scienceReferenceHelp'):t('scienceLinkHelp');
  caption.value=cap&&target?capOf(target)?.textContent??'':'';
  for(const [field,key] of [[authors,'authors'],[year,'year'],[title,'title'],[url,'url']])field.value=bib&&target?target.querySelector('[data-reference-field="'+key+'"]')?.textContent??'':'';
  description.value=target&&!cap&&!bib?(textOf(target)||target.id||'').slice(0,600):'';
 }
 function list(prefer){
  const task=mode.value,key=filter.value.trim().toLocaleLowerCase();shown=[];choices.replaceChildren();
  if(task==='scienceReference')option(choices,'',t('scienceNewReference'));
  for(const [i,target] of rows.entries()){
   if(shown.length>=maxResults){if(!prefer||shown.includes(prefer))break;if(target!==prefer)continue;}
   if(task==='scienceCaption'&&!target.matches('figure,table')||task==='scienceReference'&&!isReference(target))continue;
   const name=t(kind(target))+' · '+((textOf(target)||target.id||String(i+1)).trim().slice(0,120));
   if(key&&!(name+' '+target.id).toLocaleLowerCase().includes(key))continue;
   option(choices,String(shown.length),name);shown.push(target);
   if(target===prefer)choices.value=String(shown.length-1);
  }
  fields();
 }
 let indexed=false;
 function refresh(prefer){
  if(!panel.open)return;
  rows=[...document.body.querySelectorAll(objects)].filter(node=>writable(node)&&(!node.closest(bibliography)||isReference(node)));
  indexed=true;
  list(prefer??lastClicked?.closest(objects)??selected()?.closest(objects));
 }
 function writeReference(node){
  const who=authors.value.trim(),when=year.value.trim(),name=title.value.trim(),source=address(url.value);
  if(!name){message('scienceNeedTitle');title.focus();return;}
  if(source===null){message('scienceInvalidURL');url.focus();return;}
  let section=document.querySelector(bibliography),list=section?.querySelector(':scope > ol');
  if(section&&(!writable(section)||!list)||node&&(!writable(node)||!uniqueId(node)||!isReference(node))){message('scienceProtected');return;}
  const parent=document.querySelector('main:not([hidden])')??document.body;
  if(!section&&parent.closest(owned)){message('scienceProtected');return;}
  beforeChange();
  if(!section){section=document.createElement('section');section.dataset.websiteBibliography='';const heading=document.createElement('h2');heading.textContent=t('scienceBibliography');list=document.createElement('ol');section.append(heading,list);parent.append(section);}
  if(!node){node=document.createElement('li');node.dataset.websiteReference='';list.append(node);}
  node.id=idFor(node);
  // Keep authored notes and markup outside the four bibliographic fields.
  // Empty spans retain the position of optional fields during later edits.
  for(const [key,tag,value,prefix,suffix] of [['authors','span',who,'',' '],['year','span',when,'(',') '],['title','cite',name,'',''],['url','a',source,' · ','']]){
   let piece=node.querySelector(':scope > [data-reference-piece="'+key+'"]'),field=piece?.querySelector(':scope > [data-reference-field="'+key+'"]');
   if(!piece){piece=document.createElement('span');piece.dataset.referencePiece=key;node.append(piece);}
   if(!value){field?.remove();piece.replaceChildren();continue;}
   if(!field){field=document.createElement(tag);field.dataset.referenceField=key;piece.replaceChildren(prefix,field,suffix);}
   if(field.textContent!==value)field.textContent=value;
   if(key==='url')field.href=value;
  }
  change();filter.value='';refresh(node);message('scienceSaved');
 }
 function commit(){
  const target=choices.value===''?null:selectedTarget();
  if(mode.value==='scienceReference'){writeReference(target);return;}
  if(!writable(target)){message('scienceNeedTarget');return;}
  if(!uniqueId(target)){message('scienceDuplicate');return;}
  if(mode.value==='scienceCaption'){
   const text=caption.value.trim();let cap=capOf(target);
   if(!text){message('scienceNeedCaption');return;}
   if(cap?.children.length&&text!==cap.textContent){message('scienceRichCaption');return;}
   beforeChange();target.id=idFor(target);
   if(!cap){cap=document.createElement(target.matches('table')?'caption':'figcaption');if(target.matches('table'))target.prepend(cap);else target.append(cap);}
   if(cap.textContent!==text)cap.textContent=text;
  }else{
   const wording=description.value.trim();
   if(!wording){message('scienceNeedLink');return;}
   if(!citationRange(range,document)||target.contains(range.startContainer)){message('scienceNeedCaret');return;}
   const anchor=document.createElement('a'),id=idFor(target);anchor.href='#'+encodeURIComponent(id);anchor.textContent=wording;
   beforeChange();target.id=id;range.deleteContents();range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);
  }
  change();refresh(target);message('scienceSaved');
 }
 function deleteReference(){
  const target=choices.value===''?null:selectedTarget();if(!target||!writable(target)||!isReference(target)||!uniqueId(target))return;
  if(target.id&&[...document.querySelectorAll('a[href^="#"]')].some(a=>{try{return decodeURIComponent(a.getAttribute('href').slice(1))===target.id;}catch{return false;}})){message('scienceInUse');return;}
  beforeChange();target.remove();change();refresh();message('scienceSaved');
 }
 listen(document,'pointerup',e=>{lastClicked=element(e.target);capture();});listen(document,'keyup',capture);listen(document,'focusout',capture,{capture:true});
 listen(document,'selectionchange',()=>{if(outer.activeElement===document.defaultView.frameElement)capture();});
 // A details toggle is queued. The author may already have selected a task
 // and typed into it before the browser dispatches the opening event.
 const openIfNeeded=()=>{if(panel.open&&!indexed){status.textContent='';refresh();}};
 listen(panel,'focusin',openIfNeeded);
 listen(panel,'toggle',()=>{if(panel.open)openIfNeeded();else{indexed=false;rows=shown=[];}});
 listen(mode,'change',()=>{status.textContent='';filter.value='';refresh();});listen(filter,'input',()=>list());
 listen(choices,'change',fields);listen(apply,'click',commit);listen(remove,'click',deleteReference);
 listen(panel,'keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')&&event.target!==filter){event.preventDefault();commit();}});
}
