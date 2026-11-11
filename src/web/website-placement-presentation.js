// Occurrence ordinals use the same document order as the saved file service,
// including source-owned links and views that cannot themselves be restyled.
const marker='[data-observanda-source],[data-observanda-link]';
const block='section[data-observanda-source]:not([data-observanda-view])';
const pageSize=24;
export function presentationBlock(node){
 const section=node?.closest(block);
 return section&&!section.parentElement?.closest(marker+',header,footer,nav,template,[hidden],[data-website-instance],[data-website-region],[data-website-menu],[data-record-id],[data-public-record],[data-website-feed]')&&!section.querySelector(marker+',[data-website-instance]')?section:null;
}
function occurrences(doc,selected){
 const counts=new Map(),rows=[];let initial=0;
 for(const node of doc.body.querySelectorAll(marker)){
  const sourceId=node.dataset.observandaLink??node.dataset.observandaSource,ordinal=counts.get(sourceId)??0;
  counts.set(sourceId,ordinal+1);
  if(presentationBlock(node)!==node)continue;
  if(node.contains(selected))initial=rows.length;
  rows.push({node,sourceId,ordinal,sourceRevision:node.dataset.observandaSourceRevision});
 }
 return {rows,initial};
}
export function websitePlacementPresentation({t,request,refresh,onError}){
 let current=null;
 function close(){if(current){const {dialog}=current;current=null;dialog.close();}}
 async function revalidate(signal){
  const session=current,pin=session?.pin;if(!pin)return;
  try{
   const value=await request('library/validate',{items:[{id:pin.sourceId,revision:pin.sourceRevision}]},{signal});
   if(current===session&&pin===session.pin&&!value.accepted.includes(pin.sourceId))throw Object.assign(Error(t('changedPageAccess')),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
  }catch(error){if(current===session&&error.name!=='AbortError'){close();throw error;}}
 }
 async function open({site,page,document:doc,selected,trigger}){
  close();
  if(!document.querySelector('link[data-sheet="website-placement-presentation"]')){
   const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/website-placement-presentation.css';sheet.dataset.sheet='website-placement-presentation';document.head.append(sheet);
  }
  const {rows,initial}=occurrences(doc,selected),dialog=document.createElement('dialog');
  dialog.className='website-author-dialog website-presentation';dialog.dataset.websitePresentation='';
  const session={dialog,request:0,selected:initial,data:null};current=session;
  const heading=document.createElement('h2');heading.id='website-presentation-heading';heading.textContent=t('placementTitle');
  dialog.setAttribute('aria-labelledby',heading.id);dialog.append(heading);
  function add(tag,parent=dialog,text){
   const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;
  }
  function button(parent,label,action){
   const node=add('button',parent,label);node.className='button';node.type='button';node.addEventListener('click',action);return node;
  }
  function field(name,attr,parent=dialog){
   const label=add('label',parent,t(name)),node=add('select',label);node.setAttribute(attr,'');return node;
  }
  const context=add('p',dialog,site.name+' · '+page),help=add('p',dialog,t('placementScope'));
  context.className=help.className='muted';
  const entry=field('placementOccurrence','data-presentation-occurrence');
  const navigation=add('div');navigation.className='inline-actions';
  const prev=button(navigation,t('prevPage'),()=>load(Math.max(0,session.selected-pageSize)));
  const next=button(navigation,t('nextPage'),()=>load(Math.min(rows.length-1,session.selected+pageSize)));
  const format=add('fieldset');format.dataset.presentationFormat='';add('legend',format,t('placementFormat'));
  const options=add('div',format);options.className='website-presentation-formats';
  for(const [key,name] of [['full','placementFull'],['card','placementCard'],['section','placementSection']]){
   const tile=add('label',options),radio=add('input',tile);
   radio.type='radio';radio.name='website-entry-presentation';radio.value=key;tile.className='website-presentation-tile';
   add('span',tile,t(name));
  }
  const content=add('div');content.className='website-presentation-content';
  const choice=field('placementContent','data-presentation-choice',content);
  const preview=add('section',content),previewHeading=add('strong',preview,t('pickerPreview')),description=add('p',preview);
  preview.className='website-presentation-preview';previewHeading.id='website-presentation-preview';preview.setAttribute('aria-labelledby',previewHeading.id);
  const pages=add('div',content);pages.className='inline-actions';
  // A full copy can leave out whole parts of the entry and choose a layout.
  const record=add('fieldset');record.dataset.presentationRecord='';add('legend',record,t('placementParts'));
  const partList=add('div',record);partList.className='website-presentation-parts';
  const layout=field('placementLayout','data-presentation-layout',record);
  for(const key of ['article','plain','compact','split'])layout.add(new Option(t('placementLayout_'+key),key));
  // A card can show one of the entry's own photographs and its date.
  const card=add('fieldset');card.dataset.presentationCard='';add('legend',card,t('placementCardDetails'));
  const cover=field('placementCover','data-presentation-cover',card);
  const dateLabel=add('label',card),dateBox=add('input',dateLabel);dateBox.type='checkbox';dateBox.dataset.presentationDate='';add('span',dateLabel,t('placementShowDate'));
  dateLabel.className='website-presentation-check';
  const earlier=button(pages,t('prevPage'),()=>load(session.selected,offsets.at(-2)));
  const more=button(pages,t('nextPage'),()=>load(session.selected,session.data.next));
  const status=add('p');status.setAttribute('role','status');
  const footer=add('footer');footer.className='inline-actions';
  const cancel=button(footer,t('cancel'),close),apply=button(footer,t('placementApply'),save);
  apply.dataset.presentationApply='';apply.className='button primary';
  let offsets=[],items=[],desired='',formatKey='full',busy=false,saving=false,saved=null,groups=[],hidden=new Set(),layoutKey='article',covers=[],dated=false,coverKey='',showDate=false;
  const sameParts=()=>saved&&layoutKey===saved.layout&&[...hidden].sort().join()===saved.hidden.join();
  const sameCard=()=>saved&&coverKey===saved.cover&&showDate===saved.date;
  function controls(){
   const loaded=!!session.data;entry.disabled=busy||!rows.length;
   format.disabled=busy||!loaded;choice.disabled=busy||!loaded;
   content.hidden=formatKey==='full';preview.hidden=!description.textContent;
   record.hidden=formatKey!=='full'||!groups.length;record.disabled=busy||!loaded;
   card.hidden=formatKey!=='card'||!covers.length&&!dated;card.disabled=busy||!loaded;cover.parentElement.hidden=!covers.length;dateLabel.hidden=!dated;
   pages.hidden=offsets.length<2&&session.data?.next==null;
   earlier.disabled=busy||offsets.length<2;more.disabled=busy||session.data?.next==null;
   prev.disabled=busy||session.selected<pageSize;next.disabled=busy||Math.floor(session.selected/pageSize)*pageSize+pageSize>=rows.length;
   apply.disabled=busy||!loaded||(formatKey!=='full'&&!desired)||(formatKey===saved?.format&&desired===saved?.choice&&(formatKey!=='full'||sameParts())&&(formatKey!=='card'||sameCard()))||(formatKey==='full'&&groups.length>0&&hidden.size>=groups.length);
   cancel.disabled=saving;
  }
  function showChoices(){
   for(const radio of format.elements)radio.checked=radio.value===formatKey;
   choice.replaceChildren();if(formatKey==='card')choice.add(new Option(t('placementTitleOnly'),'title'));
   for(const item of items){
    if(formatKey==='section'&&!['section','table'].includes(item.kind)||formatKey==='card'&&item.kind==='table')continue;
    const name=item.kind==='table'?t('scienceTable')+' · '+(item.title||item.preview||t('tableViewport')):item.title||t(({body:'pickerBody',outcome:'pickerOutcome',results:'pickerResults',contributors:'pickerContributors',tags:'pickerTags'})[item.key]??'placementContent');
    choice.add(new Option(name,item.key));
   }
   if(desired&&![...choice.options].some(o=>o.value===desired))choice.add(new Option(t('placementCurrent'),desired),0);
   if(!desired&&formatKey!=='full')choice.add(new Option(t('placementChooseSection'),''),0);
   choice.value=desired;description.textContent=items.find(item=>item.key===desired)?.preview??'';
   partList.replaceChildren();
   for(const group of groups){
    const label=add('label',partList),box=add('input',label);box.type='checkbox';box.value=group;box.checked=!hidden.has(group);
    box.dataset.presentationPart=group;add('span',label,t('placementPart_'+group));
    box.onchange=()=>{if(box.checked)hidden.delete(group);else hidden.add(group);controls();};
   }
   layout.value=layoutKey;
   cover.replaceChildren(new Option(t('placementNoCover'),''),...covers.map(item=>new Option(item.label||t('placementCoverPhoto'),item.key)));
   cover.value=covers.some(item=>item.key===coverKey)?coverKey:'';dateBox.checked=showDate;controls();
  }
  function pin(){
   const {sourceId,ordinal,sourceRevision}=rows[session.selected];
   return {siteId:site.id,expectedRevision:site.revision,path:page,sourceId,sourceRevision,ordinal};
  }
  function fail(error){if(current===session){close();onError(error);}}
  async function load(index,offset=0){
   if(!rows[index])return;
   const version=++session.request,reset=!session.data||index!==session.selected;
   session.selected=index;session.pin=pin();busy=true;controls();
   const from=Math.floor(index/pageSize)*pageSize;entry.replaceChildren();
   rows.slice(from,from+pageSize).forEach(({node},i)=>{
    const title=node.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim().slice(0,120)||t('placementOccurrence');
    entry.add(new Option((from+i+1)+'. '+title,String(from+i)));
   });entry.value=String(index);navigation.hidden=rows.length<=pageSize;
   try{
    const result=await request('library/presentation-options',{...pin(),offset,limit:12});
    if(current!==session||version!==session.request)return;
    if(result.revision!==site.revision||result.sourceRevision!==pin().sourceRevision)throw Error(t('changedPageAccess'));
    session.data=result;items=result.items;const found=offsets.indexOf(offset);
    offsets=reset?[offset]:found===-1?[...offsets,offset]:offsets.slice(0,found+1);
    if(reset){
     formatKey=result.presentation;desired=formatKey==='full'||result.unavailable?'':result.choice??(formatKey==='card'?'title':'');
     groups=result.record?.groups??[];hidden=new Set(result.record?.hidden??[]);layoutKey=result.record?.layout??'article';
     covers=result.card?.covers??[];dated=Boolean(result.card?.date);coverKey=result.card?.cover??'';showDate=Boolean(result.card?.showDate);
     saved={format:formatKey,choice:desired,hidden:[...hidden].sort(),layout:layoutKey,cover:coverKey,date:showDate};
    }
    status.textContent=result.unavailable?t('placementUnavailable'):'';status.hidden=!status.textContent;busy=false;showChoices();
   }catch(error){fail(error);}
  }
  async function save(){
   if(apply.disabled)return;busy=saving=true;controls();
   try{
    const result=await request('library/present-placement',{...pin(),presentation:formatKey,...(formatKey==='full'?{hidden:[...hidden].filter(group=>groups.includes(group)).sort(),layout:layoutKey}:{choice:desired}),...(formatKey==='card'?{cover:coverKey||null,date:showDate}:{})});
    if(current!==session)return;close();refresh(result);
   }catch(error){fail(error);}
  }
  entry.onchange=()=>load(Number(entry.value));
  format.onchange=event=>{formatKey=event.target.value;desired=formatKey===saved?.format?saved.choice:formatKey==='card'?'title':'';showChoices();};
  choice.onchange=()=>{desired=choice.value;showChoices();};
  layout.onchange=()=>{layoutKey=layout.value;controls();};
  cover.onchange=()=>{coverKey=cover.value;controls();};
  dateBox.onchange=()=>{showDate=dateBox.checked;controls();};
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{if(current===session)current=null;dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
  document.body.append(dialog);dialog.showModal();
  if(rows.length){await load(initial);if(current===session)entry.focus();}
  else{entry.parentElement.hidden=format.hidden=content.hidden=record.hidden=card.hidden=navigation.hidden=apply.hidden=true;status.textContent=t('placementEmpty');cancel.focus();}
 }
 return {open,close,revalidate};
}
