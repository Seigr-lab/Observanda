import {PdfLayoutError} from './web/pdf-layout-model.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
export function validPdfFootnoteFlow(value){
 return exact(value,'version,defaultLayout,layouts')&&value.version===1&&Array.isArray(value.layouts)&&value.layouts.length>0&&value.layouts.length<=12000&&new Set(value.layouts.map(row=>row?.name)).size===value.layouts.length&&value.layouts.every(row=>exact(row,'name,widthMm,heightMm,columns,columnGapMm')&&typeof row.name==='string'&&/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(row.name)&&['widthMm','heightMm'].every(key=>Number.isFinite(row[key])&&row[key]>=20&&row[key]<=1000)&&Number.isInteger(row.columns)&&row.columns>=1&&row.columns<=4&&Number.isFinite(row.columnGapMm)&&row.columnGapMm>=0&&row.columnGapMm<=100)&&value.layouts.some(row=>row.name===value.defaultLayout);
}
// A trusted renderer script: it paginates a copy of compiled DOM only. Original
// authored values remain in the document owner; failure restores the input DOM.
async function paginateFootnotes(configuration,maxBytes){
 const mm=96/25.4,epsilon=.15,layouts=new Map(configuration.layouts.map(row=>[row.name,row])),templates=[...document.querySelectorAll('template[data-pdf-footnote-source]')];
 if(!templates.length)return {pages:0,footnotes:0,fragments:0};
 const original=[...document.body.childNodes],byteSize=value=>new TextEncoder().encode(value).byteLength,identities=new WeakMap();let failureContext=document.querySelector('[data-pdf-footnote-call]');
 const refusal=(code,node=failureContext,details={})=>{const section=node?.closest?.('.pdf-section')??node?.closest?.('[id^=pdf-section-]'),raw=section?.dataset.pdfSectionId??section?.id.replace(/^pdf-section-/,''),call=node?.matches?.('[data-pdf-footnote-call]')?node:node?.querySelector?.('[data-pdf-footnote-call]'),block=Number(call?.dataset.pdfFootnoteBlock);return {version:1,status:'fatal',findings:[{code,severity:'fatal',sectionId:/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw??'')?raw:null,blockId:(call?.id||node?.dataset?.pdfBlockId||node?.id||null),blockIndex:Number.isSafeInteger(block)&&block>0?block-1:null,...(identities.get(node)??{}),details:Object.fromEntries(Object.entries(details).map(([key,value])=>[key,Math.round(Math.max(0,value)*100)/100]))}],truncated:false};};
 const fail=(code='PDF_FOOTNOTE_OVERFLOW',node=failureContext,details={})=>{throw Object.assign(Error(code),{code,...(['PDF_FOOTNOTE_LAYOUT','PDF_FOOTNOTE_OVERFLOW'].includes(code)?{preflight:refusal(code,node,details)}:{})});};
 if(byteSize(document.body.innerHTML)>maxBytes)fail('PDF_CAPACITY');
 await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>fail('PDF_FOOTNOTE_LAYOUT'))));
 const styles=document.createElement('style');styles.dataset.pdfFootnoteFlow='';styles.textContent='.pdf-footnote-page{box-sizing:border-box!important;display:flex!important;flex-direction:column!important;column-count:1!important;position:relative!important;margin:0!important;padding:0!important;overflow:visible!important;break-after:page!important;flex:none!important}.pdf-footnote-page:last-child{break-after:auto!important}.pdf-footnote-main{display:flow-root;flex:0 0 auto;min-width:0;width:100%}.pdf-page-footnotes{display:flow-root;flex:0 0 auto;margin-top:auto;min-width:0;width:100%;border-top:.25mm solid currentColor;padding-top:2mm}.pdf-page-footnotes[hidden]{display:none!important}.pdf-page-footnotes>ol{margin:0;padding-inline-start:1.6em}.pdf-page-footnotes li{break-inside:auto!important}.pdf-page-footnotes p:last-child{margin-bottom:0}.pdf-footnote-main>section,.pdf-footnote-main>nav{page:auto!important;break-before:auto!important;break-after:auto!important;column-count:1!important}.pdf-footnote-keep{display:flow-root}.pdf-footnote-positioned>.pdf-page-footnotes{position:absolute;inset:auto 0 0;margin:0}.pdf-footnote-positioned>.pdf-footnote-main{height:auto}';
 const sources=[],notes=new Map(),calls=new Set(),seenIds=new Set(),flow=new WeakMap();
 function remember(rendered,source=rendered){
  const actual=[rendered,...rendered.querySelectorAll('*')],original=[source,...source.querySelectorAll('*')];
  for(let index=0;index<actual.length;index++){
   const node=actual[index],style=getComputedStyle(node),rects=[];
   if(/^(P|PRE|H[1-6])$/.test(node.tagName)){const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode()){if(!text.data.trim())continue;const range=document.createRange();range.selectNodeContents(text);rects.push(...range.getClientRects());}}
   const columnHost=rendered.closest('.pdf-footnote-main'),columnBox=columnHost?.getBoundingClientRect(),columns=columnHost?Number(getComputedStyle(columnHost).columnCount)||1:1,stride=columns>1?(columnBox.width+parseFloat(getComputedStyle(columnHost).columnGap))/(columns):Infinity;const lines=[];for(const rect of rects.filter(rect=>rect.width&&rect.height).sort((a,b)=>a.top-b.top)){const column=columnBox?Math.max(0,Math.floor((rect.left-columnBox.left+.1)/stride)):0,line=lines.find(line=>line.column===column&&rect.top<line.bottom-.1&&rect.bottom>line.top+.1);if(line){line.top=Math.min(line.top,rect.top);line.bottom=Math.max(line.bottom,rect.bottom);}else lines.push({top:rect.top,bottom:rect.bottom,column});}
   if(original[index])flow.set(original[index],{inside:style.breakInside,after:style.breakAfter,before:style.breakBefore,widows:Number(style.widows)||2,orphans:Number(style.orphans)||2,lines:lines.length});
  }
 }
 const avoid=value=>['avoid','avoid-page','avoid-column'].includes(value),forced=value=>['page','always','left','right','recto','verso'].includes(value);
 const copy=(node,deep=true)=>{const result=node.cloneNode(deep),from=[node,...(deep?[...node.querySelectorAll?.('*')??[]]:[])],to=[result,...(deep?[...result.querySelectorAll?.('*')??[]]:[])];from.forEach((item,index)=>{if(flow.has(item))flow.set(to[index],flow.get(item));});return result;};
 for(const root of [...document.body.children]){
  if(!['SECTION','NAV'].includes(root.tagName))fail('PDF_FOOTNOTE_LAYOUT');
  const name=getComputedStyle(root).page,layout=layouts.get(name)||layouts.get(configuration.defaultLayout),composed=root.matches('.pdf-composed-section');if(layout.widthMm-layout.columnGapMm*(layout.columns-1)<=0||composed&&layout.columns!==1)return {pages:0,footnotes:templates.length,fragments:0,preflight:refusal('PDF_FOOTNOTE_LAYOUT',root)};
  const clone=copy(root),identity=refusal('PDF_FOOTNOTE_OVERFLOW',root).findings[0];identities.set(clone,{sectionId:identity.sectionId,blockId:identity.blockId,blockIndex:identity.blockIndex});remember(root,clone);for(const template of clone.querySelectorAll('template[data-pdf-footnote-source]')){
   const key=template.dataset.pdfFootnoteSource,node=template.content.firstElementChild;if(!/^[A-Za-z0-9_-]{1,256}$/.test(key)||notes.has(key)||template.content.children.length!==1||node?.tagName!=='LI'||!node.querySelector('aside[id][role="doc-footnote"]'))fail('PDF_FOOTNOTE_LAYOUT');
   const body=node.cloneNode(true),aside=body.querySelector('aside'),backlink=aside.querySelector('p:has([role="doc-backlink"])');backlink?.remove();notes.set(key,{key,node:body,anchor:aside.id,backlink,continuation:0,context:clone});template.remove();
  }
  for(const call of clone.querySelectorAll('[data-pdf-footnote-call]')){const key=call.dataset.pdfFootnoteCall;if(calls.has(key)||!call.id)fail('PDF_FOOTNOTE_LAYOUT');calls.add(key);}
  // A note's block is the boundary AFTER that prose block (zero precedes
  // the first block). Keep every call in a repeated boundary group in order.
  for(const call of [...clone.querySelectorAll('[data-pdf-footnote-call]')]){
   if(call.closest('p,pre,h1,h2,h3,h4,h5,h6,li,figcaption,td,th'))continue;const block=Number(call.dataset.pdfFootnoteBlock);if(!Number.isSafeInteger(block)||block<0)fail('PDF_FOOTNOTE_LAYOUT');
   const group=[call];let next=call.nextElementSibling;while(next?.matches('[data-pdf-footnote-call]')&&next.dataset.pdfFootnoteBlock===call.dataset.pdfFootnoteBlock){group.push(next);next=next.nextElementSibling;}
   const leading=call.parentElement.matches('.pdf-composition-leading')?call.parentElement:null,target=block>0?call.previousElementSibling:(leading?.nextElementSibling??next);
   if(!target||target.matches('[data-pdf-footnote-call]')){const paragraph=document.createElement('p');call.before(paragraph);paragraph.append(...group);continue;}
   const leaves=[...(target.matches('p,pre,h1,h2,h3,h4,h5,h6,li,figcaption,td,th')?[target]:target.querySelectorAll('p,pre,h1,h2,h3,h4,h5,h6,li,figcaption,td,th'))],leaf=block>0?leaves.at(-1):leaves[0];
   if(leaf){if(block>0)leaf.append(...group);else leaf.prepend(...group);if(leading&&!leading.textContent)leading.remove();}
   else{const holder=document.createElement('div');holder.className='pdf-footnote-keep';holder.style.breakInside='avoid';target.before(holder);holder.append(...(block>0?[target,...group]:[...group,target]));flow.set(holder,{inside:'avoid',after:flow.get(target)?.after});}
  }
  const units=[...clone.childNodes].filter(node=>node.nodeType!==Node.TEXT_NODE||node.textContent.trim());
  for(let index=0;index<units.length-1;index++)if(avoid(flow.get(units[index])?.after)){
   const group=document.createElement('div');group.className='pdf-footnote-keep';group.dataset.pdfKeepHeading='';let end=index+1;while(end<units.length-1&&avoid(flow.get(units[end])?.after))end++;group.append(...units.slice(index,end+1));units.splice(index,end-index+1,group);
  }
  sources.push({root:clone,layout,units,composed,used:false,start:root.getAttribute('data-start')||getComputedStyle(root).breakBefore,end:getComputedStyle(root).breakAfter});
 }
 if(notes.size!==calls.size||[...calls].some(key=>!notes.has(key)))fail('PDF_FOOTNOTE_LAYOUT');
 // Template contents are inert: document.images does not include them. Decode
 // authorized note images off-flow before any fragment geometry is measured.
 const imageNotes=[...notes.values()].filter(note=>note.node.querySelector('img'));if(imageNotes.length){const loading=document.createElement('div');loading.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';document.body.append(loading);try{for(const note of imageNotes){loading.append(note.node);try{await Promise.all([...note.node.querySelectorAll('img')].map(image=>image.decode()));}catch{return {pages:0,footnotes:notes.size,fragments:0,preflight:refusal('PDF_IMAGE_MISSING',note.context)};}}}finally{loading.remove();}}

 for(const node of document.querySelectorAll('[id]')){if(seenIds.has(node.id))fail('PDF_FOOTNOTE_LAYOUT');seenIds.add(node.id);}
 const pages=[],started=new Set();let page=null,carry=[],fragments=0,operations=0;
 function cleanIds(head,tail){const ids=new Set([head,...head.querySelectorAll('[id]')].map(node=>node.id).filter(Boolean));for(const node of [tail,...tail.querySelectorAll('[id]')])if(ids.has(node.id))node.removeAttribute('id');}
 const shallow=node=>copy(node,false);
 function meaningful(node){return !!node.textContent.trim()||!!node.querySelector('img,svg,math');}
 function splitText(node,fits,minimum=false){
  if(node.querySelector('img,svg,math,table'))return null;
  const limits=flow.get(node)||{widows:2,orphans:2},walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),textNodes=[];let total=0,current;while(current=walker.nextNode()){textNodes.push({node:current,start:total,end:total+current.length});total+=current.length;}
  if(total<2)return null;const text=textNodes.map(row=>row.node.data).join('');
  const point=offset=>{const row=textNodes.find(row=>row.end>=offset);return row?{node:row.node,offset:offset-row.start}:null;};
  const divide=offset=>{const stop=point(offset);if(!stop||stop.node.parentElement.closest('[data-pdf-footnote-call]'))return null;const first=document.createRange(),last=document.createRange();first.selectNodeContents(node);first.setEnd(stop.node,stop.offset);last.selectNodeContents(node);last.setStart(stop.node,stop.offset);const head=shallow(node),tail=shallow(node);head.append(first.cloneContents());tail.append(last.cloneContents());cleanIds(head,tail);return meaningful(head)&&meaningful(tail)?[head,tail]:null;};
  const wordEnds=[...text.matchAll(/\s+|[-\u200b]/gu)].map(match=>match.index+match[0].length).filter(index=>index>0&&index<total);
  function search(boundaries){
   let low=0,high=boundaries.length-1,best=-1;
   while(low<=high){const middle=(low+high)>>1,parts=divide(boundaries[middle]);if(!parts){high=middle-1;continue;}const fit=fits(parts[0]),lines=flow.get(parts[0])?.lines??0;if(minimum){if(lines>=limits.orphans){best=middle;high=middle-1;}else low=middle+1;}else if(fit){best=middle;low=middle+1;}else high=middle-1;}
   for(let index=best;index>=0;index--){const parts=divide(boundaries[index]);if(!parts)continue;const fit=fits(parts[0]),headLines=flow.get(parts[0])?.lines??0;if(headLines<limits.orphans)return null;fits(parts[1]);const tailLines=flow.get(parts[1])?.lines??0;if(fit&&tailLines>=limits.widows)return parts;if(minimum)return null;}
   return null;
  }
  let result=search(wordEnds);if(!result&&!wordEnds.length){const ends=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(segment=>segment.index+segment.segment.length).filter(index=>index<total);result=search(ends);}return result;
 }
 function splitTable(node,fits,minimum=false){
  const table=node.matches('table')?node:node.querySelector('table'),rows=[...table.querySelectorAll(':scope>tbody>tr,:scope>tr')];if(rows.length<2||table.querySelector('[rowspan]:not([rowspan="1"])'))return null;
  const divide=count=>{const head=copy(node),tail=copy(node),a=head.matches('table')?head:head.querySelector('table'),b=tail.matches('table')?tail:tail.querySelector('table');[...a.querySelectorAll(':scope>tbody>tr,:scope>tr')].slice(count).forEach(row=>row.remove());[...b.querySelectorAll(':scope>tbody>tr,:scope>tr')].slice(0,count).forEach(row=>row.remove());a.querySelector('tfoot')?.remove();b.querySelector('caption')?.remove();cleanIds(head,tail);return [head,tail];};
  if(minimum){const parts=divide(1);return fits(parts[0])?parts:null;}
  let low=1,high=rows.length-1,best=null;while(low<=high){const middle=(low+high)>>1,parts=divide(middle);if(fits(parts[0])){best=parts;low=middle+1;}else high=middle-1;}return best;
 }
 function split(node,fits,minimum=false){
  if(node.nodeType!==Node.ELEMENT_NODE||node.matches('.pdf-composition-page')||avoid(flow.get(node)?.inside))return null;
  if(/^(P|PRE|H[1-6])$/.test(node.tagName))return splitText(node,fits,minimum);
  if(node.matches('table,.book-table,.book-table-scroll'))return splitTable(node,fits,minimum);
  if(!/^(DIV|SECTION|ARTICLE|ASIDE|BLOCKQUOTE|UL|OL|LI|NAV)$/.test(node.tagName))return null;
  const children=[...node.childNodes].filter(child=>child.nodeType!==Node.TEXT_NODE||child.textContent.trim());if(!children.length)return null;
  const head=shallow(node),tail=shallow(node);let count=0,part=null;
  const partial=child=>split(child,fragment=>{const trial=copy(head);trial.append(copy(fragment));const result=fits(trial);const measured=trial.lastChild;if(flow.has(measured))flow.set(fragment,flow.get(measured));return result;},minimum);
  for(;count<children.length;count++){
   if(minimum&&!avoid(flow.get(children[count])?.after)){part=partial(children[count]);if(part){head.append(part[0]);tail.append(part[1]);count++;break;}}
   head.append(copy(children[count]));if(!fits(head)){head.lastChild.remove();part=partial(children[count]);if(part){head.append(part[0]);tail.append(part[1]);count++;}break;}
   if(minimum&&!avoid(flow.get(children[count])?.after)&&count<children.length-1){count++;break;}
  }
  if(count===children.length&&!tail.childNodes.length)return null;
  if(!part&&count&&avoid(flow.get(children[count-1])?.after))return null;
  for(let index=count;index<children.length;index++)tail.append(copy(children[index]));
  if(!meaningful(head)||!meaningful(tail)||node.hasAttribute('data-pdf-keep-heading')&&head.children.length<2)return null;
  if(node.tagName==='OL'){const start=Number(node.getAttribute('start')||1),consumed=[...head.children].filter(child=>child.tagName==='LI').length;tail.setAttribute('start',String(start+consumed-(part?1:0)));if(part&&tail.firstElementChild)tail.firstElementChild.style.listStyleType='none';}
  cleanIds(head,tail);return [head,tail];
 }
 function newPage(layout){
  if(pages.length>=100000)fail('PDF_CAPACITY');const node=document.createElement('section');node.className='pdf-footnote-page '+layout.name;node.dataset.pdfFootnotePage=String(pages.length+1);node.style.width=layout.widthMm+'mm';node.style.height=(layout.heightMm*mm-.2)+'px';node.style.page=layout.name;
  const main=document.createElement('div'),region=document.createElement('section'),list=document.createElement('ol');main.className='pdf-footnote-main';if(layout.columns>1){main.style.columnCount=String(layout.columns);main.style.columnGap=layout.columnGapMm+'mm';main.style.columnFill='auto';}region.className='pdf-page-footnotes';region.hidden=true;region.append(list);node.append(main,region);document.body.append(node);
  page={node,main,region,list,layout,height:layout.heightMm*mm-.2,inputs:carry,required:new Set(),wrappers:new Map(),plan:null,units:0,mainHeight:null,positioned:false};carry=[];pages.push(page);return page;
 }
 function noteView(entry,node){const result=node.cloneNode(true),aside=result.querySelector('aside');if(!aside)fail('PDF_FOOTNOTE_LAYOUT');if(entry.continuation){aside.id=entry.anchor+'-continued-'+entry.continuation;result.dataset.pdfFootnoteContinuation=String(entry.continuation);}if(entry.backlink)aside.append(entry.backlink.cloneNode(true));result.dataset.pdfFootnoteKey=entry.key;return result;}
 function notePlan(inputs,available,required=new Set()){
  page.list.replaceChildren();page.region.hidden=!inputs.length;if(!inputs.length)return {views:[],remaining:[],keys:new Set()};
  const views=[],remaining=[],keys=new Set(),minimum=new Map();
  const fits=(entry,node,budget=available)=>{const view=noteView(entry,node);page.list.append(view);remember(view,node);const result=page.region.getBoundingClientRect().height<=budget+epsilon;view.remove();return result;};
  // Reserve a legal first fragment for each call on this page before allowing
  // an earlier long note to consume all available space.
  for(const entry of inputs)if(required.has(entry.key)){
   const whole=fits(entry,entry.node),parts=split(entry.node,part=>fits(entry,part),true),node=parts?.[0]||(whole?entry.node:null);if(!node)return {views:[],remaining:inputs,keys};
   const view=noteView(entry,node);page.list.append(view);minimum.set(entry.key,view.getBoundingClientRect().height);view.remove();
  }
  for(const entry of inputs){
   let node=entry.node,tail=null;minimum.delete(entry.key);const reserved=[...minimum.values()].reduce((sum,value)=>sum+value,0),budget=available-reserved;
   if(!fits(entry,node,budget)){const parts=split(node,part=>fits(entry,part,budget));if(!parts){remaining.push(entry);continue;}[node,tail]=parts;}
   const view=noteView(entry,node);views.push(view);page.list.append(view);keys.add(entry.key);if(tail)remaining.push({...entry,node:tail,continuation:entry.continuation+1});
  }
  page.region.hidden=!views.length;return {views,remaining,keys};
 }
 function restoreNotes(){page.list.replaceChildren(...(page.plan?.views??[]));page.region.hidden=!page.plan?.views.length;if(page.layout.columns>1)page.main.style.height=(page.mainHeight??page.height)+'px';}
 function wrapper(source){let value=page.wrappers.get(source);if(!value){value=source.root.cloneNode(false);value.removeAttribute('data-start');value.style.setProperty('break-before','auto','important');value.style.setProperty('break-after','auto','important');value.style.setProperty('page','auto','important');if(source.used)value.removeAttribute('id');if(source.root.id?.startsWith('pdf-section-'))value.dataset.pdfSectionId=source.root.id.slice(12);page.main.append(value);page.wrappers.set(source,value);}return value;}
 function mainHeight(){
  if(page.positioned){const box=page.main.getBoundingClientRect();let bottom=0;for(const item of page.main.querySelectorAll('.pdf-composition-item')){const rect=item.getBoundingClientRect();bottom=Math.max(bottom,rect.bottom-box.top);for(const child of item.querySelectorAll('*'))for(const part of child.getClientRects())bottom=Math.max(bottom,part.bottom-box.top);}return bottom;}
  if(page.layout.columns===1)return page.main.getBoundingClientRect().height;
  const fits=height=>{page.main.style.height=height+'px';const box=page.main.getBoundingClientRect();if(page.main.scrollWidth>Math.ceil(box.width)+1)return false;for(const element of page.main.querySelectorAll('*'))for(const rect of element.getClientRects())if(rect.width&&rect.height&&(rect.left<box.left-epsilon||rect.right>box.right+epsilon||rect.bottom>box.top+height+epsilon))return false;return true;};
  if(!fits(page.height))return Infinity;let low=0,high=page.height;while(high-low>.12){const middle=(high+low)/2;if(fits(middle))high=middle;else low=middle;}high=Math.min(page.height,high+.15);fits(high);return high;
 }
 function flowGeometry(height){for(const host of page.wrappers.values()){host.dataset.pdfFlowWidthMm=String((page.layout.widthMm-page.layout.columnGapMm*(page.layout.columns-1))/page.layout.columns);host.dataset.pdfFlowHeightMm=String(height/mm);}}
 function candidate(source,node,commit=false){
  page.positioned=source.composed;page.node.classList.toggle('pdf-footnote-positioned',source.composed);const host=wrapper(source);host.append(node);const height=mainHeight();remember(node);const newKeys=[...(node.matches?.('[data-pdf-footnote-call]')?[node]:[]),...node.querySelectorAll?.('[data-pdf-footnote-call]')??[]].map(call=>call.dataset.pdfFootnoteCall).filter(key=>!started.has(key)),inputs=[...page.inputs,...newKeys.map(key=>notes.get(key))],required=new Set([...page.required,...newKeys]);
  let plan=null,accepted=false;if(height<=page.height+epsilon){plan=notePlan(inputs,page.height-height,required);accepted=[...required].every(key=>plan.keys.has(key))&&(!inputs.length||plan.views.length>0);}
  if(accepted&&commit){page.inputs=inputs;page.required=required;page.plan=plan;page.mainHeight=height;flowGeometry(source.composed?page.height:height);page.units++;source.used=true;for(const key of newKeys)started.add(key);return true;}
  if(!accepted){page.failure={heightPx:Number.isFinite(height)?height:page.height+.2,availableHeightPx:Math.max(0,page.height-height)};if(source.composed&&inputs.length){page.list.replaceChildren(...inputs.map(entry=>noteView(entry,entry.node)));page.region.hidden=false;page.failure.heightPx=page.region.getBoundingClientRect().height;}}
  node.remove();if(!host.childNodes.length){host.remove();page.wrappers.delete(source);}restoreNotes();return accepted;
 }
 function finish(){
  if(!page)return;
  if(!page.plan){page.plan=notePlan(page.inputs,page.height-mainHeight());if(page.inputs.length&&!page.plan.views.length)fail();}
  carry=page.plan.remaining;fragments+=page.plan.views.length;
  const main=page.main.getBoundingClientRect(),region=page.region.getBoundingClientRect(),box=page.node.getBoundingClientRect();const occupied=page.positioned?main.top+(page.mainHeight??0):main.bottom;if((!page.positioned&&main.height>page.height+epsilon)||page.plan.views.length&&(region.bottom>box.bottom+epsilon||occupied>region.top+epsilon))fail('PDF_FOOTNOTE_OVERFLOW',failureContext,page.failure??{});page=null;
 }
 try{
  document.head.append(styles);document.body.replaceChildren();
  for(const source of sources){
   failureContext=source.root;
   if(page&&(page.layout.name!==source.layout.name||forced(source.start)))finish();
   while(carry.length){newPage(pages.at(-1).layout);finish();if(++operations%20===0)await new Promise(resolve=>setTimeout(resolve,0));}
   if(['recto','verso','left','right'].includes(source.start)){const wanted=['recto','right'].includes(source.start)?1:0;if((pages.length+1)%2!==wanted){newPage(source.layout);finish();}}
   const queue=source.units.slice();
   while(queue.length){
    if(!page)newPage(source.layout);const node=queue[0];if(candidate(source,node,true)){queue.shift();}
    else{const parts=split(node,part=>candidate(source,part));if(parts&&candidate(source,parts[0],true)){queue[0]=parts[1];finish();}else if(page.units||page.inputs.length){finish();}else fail('PDF_FOOTNOTE_OVERFLOW',source.root,page.failure??{});}
    if(++operations%20===0)await new Promise(resolve=>setTimeout(resolve,0));
   }
   if(forced(source.end))finish();
  }
  finish();while(carry.length){newPage(pages.at(-1).layout);finish();if(++operations%20===0)await new Promise(resolve=>setTimeout(resolve,0));}
  if(started.size!==notes.size)fail('PDF_FOOTNOTE_LAYOUT');const finalIds=new Set();for(const node of document.querySelectorAll('[id]')){if(finalIds.has(node.id))fail('PDF_FOOTNOTE_LAYOUT');finalIds.add(node.id);}const finalCalls=[...document.querySelectorAll('[data-pdf-footnote-call]')];if(finalCalls.length!==calls.size||new Set(finalCalls.map(node=>node.dataset.pdfFootnoteCall)).size!==calls.size||[...notes.values()].some(note=>!finalIds.has(note.anchor)))fail('PDF_FOOTNOTE_LAYOUT');if(byteSize(document.body.innerHTML)>maxBytes)fail('PDF_CAPACITY');return {pages:pages.length,footnotes:notes.size,fragments};
 }catch(error){document.body.replaceChildren(...original);styles.remove();if(error.preflight)return {pages:0,footnotes:notes.size,fragments:0,preflight:error.preflight};throw error;}
}
export function pdfFootnoteFlowScript(value,{maxBytes=64*1024*1024}={}){
 if(!validPdfFootnoteFlow(value)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new PdfLayoutError('PDF_FOOTNOTE_LAYOUT');
 return '('+paginateFootnotes.toString()+')('+JSON.stringify(value)+','+maxBytes+')';
}
