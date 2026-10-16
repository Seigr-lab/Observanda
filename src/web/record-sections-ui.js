import {ownedAssetURL} from './project-context.js';
import {editableRecord} from './workspace-snapshot.js';
import {proseText,renderProse} from './prose-model.js';
import {recordFigureRenderer} from './book-reading.js';
import {sectionAnchor} from './record-workflow.js';
import {t} from './i18n/index.js';

// This window is presentation state, not a record edit. Section identities and
// their order belong to the record, including when edits cross a window edge.
export function recordSectionsUI({state,documents,esc,field,icon,dirty,render}){
 const text=(key,args)=>t('recordSections',key,args),size=4;
 let owner=null,first=null,offset=0,focus=null,anchor=null,search='',lastSearch=null;
 const record=()=>state.book?.entries.find(r=>r.id===state.selected);
 function position(e){
  const key=JSON.stringify([state.storage?.contextId,state.book.id,e.id]);
  if(owner!==key){owner=key;first=null;offset=0;focus=null;anchor=null;search='';lastSearch=null;}
  if(first){const i=e.sections.findIndex(s=>s.id===first);if(i>=0)offset=i;}
  offset=Math.min(offset,Math.max(0,e.sections.length-1));first=e.sections[offset]?.id??null;
  const target=state.recordReading?state.recordSection:null;
  if(target&&anchor!==target){
   const contains=node=>node&&typeof node==='object'&&(node.attrs?.id&&target.endsWith(node.attrs.id)||node.attrs?.figureId&&target.endsWith(node.attrs.figureId)||(node.content??[]).some(contains));
   const i=e.sections.findIndex(s=>target===s.id||target===sectionAnchor(s)||contains(s.body));
   if(i>=0)choose(e,i);anchor=target;
  }else if(!target)anchor=null;
 }
 function choose(e,index){offset=Math.max(0,Math.min(index,Math.max(0,e.sections.length-1)));first=e.sections[offset]?.id??null;}
 function navigation(e){
  if(e.sections.length<=size)return '';
  const button=(key,direction,disabled)=>`<button type="button" class="button" data-action="section-window" data-direction="${direction}" ${disabled?'disabled':''}>${esc(text(key))}</button>`;
  return `<nav class="record-section-navigation" aria-label="${esc(text('navigation'))}"><span role="status">${esc(text('range',{first:offset+1,last:Math.min(e.sections.length,offset+size),total:e.sections.length}))}</span><div class="inline-actions">${button('previous','previous',offset===0)}${button('next','next',offset+size>=e.sections.length)}</div>${field(esc(text('goTo')),`<input type="number" inputmode="numeric" data-section-position required min="1" max="${e.sections.length}" value="${offset+1}">`)}<button type="button" class="button" data-action="section-go">${esc(text('go'))}</button><div class="record-section-find">${field(esc(text('findHeading')),`<input type="search" data-section-search value="${esc(search)}">`)}<button type="button" class="button" data-action="section-find">${esc(text('findNext'))}</button><span data-section-search-status role="status"></span></div></nav>`;
 }
 function view(e,{readonly=false,figure=recordFigureRenderer(e,esc,{assetUrl:id=>ownedAssetURL(state,'/api/media/'+id)})}={}){
  position(e);const selected=e.sections.slice(offset,offset+size);
  const links=readonly?`<nav class="record-contents" aria-label="${esc(text('contents'))}">${selected.map(s=>`<a href="#/records/${e.id}/read/${s.id}" data-action="record-section-jump" data-id="${s.id}">${esc(s.title)}</a>`).join('')}</nav>`:'';
  return `<section class="record-sections" aria-label="${esc(text('title'))}"><h3>${esc(text('title'))}</h3>${navigation(e)}${links}${selected.map((section,i)=>{
   const index=offset+i;
   if(readonly)return `<section id="${sectionAnchor(section)}" tabindex="-1"><h2>${esc(section.title)}</h2>${renderProse(section.body,{figure})}</section>`;
   const move=(direction,disabled)=>`<button type="button" class="icon-button" data-action="section-${direction}" data-id="${section.id}" aria-label="${esc(text(direction,{title:section.title}))}" ${disabled?'disabled':''}>${direction==='up'?'&uarr;':'&darr;'}</button>`;
   return `<div class="record-section" data-writing-section="${section.id}"><div class="section-controls">${field(esc(text('heading')),`<input data-writing-heading="${section.id}" value="${esc(section.title)}" maxlength="160">`)}${move('up',index===0)}${move('down',index===e.sections.length-1)}<button type="button" class="icon-button" data-action="section-remove" data-id="${section.id}" aria-label="${esc(text('remove',{title:section.title}))}">${icon('trash')}</button></div>${documents.field({key:e.id+':'+section.id,label:text('content',{title:section.title}),value:section.body,set:value=>{editableRecord(state.book,e.id).sections.find(s=>s.id===section.id).body=value;dirty(e.id);}})}</div>`;
  }).join('')}${readonly?'':`<button type="button" class="button" data-action="section-add">${icon('plus')}${esc(text('add'))}</button>`}</section>`;
 }
 function input(el){
  if(el.hasAttribute('data-section-search')){search=el.value;return true;}
  if(!el.dataset.writingHeading)return false;const e=record(),s=editableRecord(state.book,e.id).sections.find(s=>s.id===el.dataset.writingHeading);if(!s)return true;
  s.title=el.value;const host=el.closest('.record-section');host.querySelector('.document-label').textContent=text('content',{title:s.title});host.querySelector('[contenteditable]')?.setAttribute('aria-label',text('content',{title:s.title}));dirty(e.id);return true;
 }
 function action(control){
  const name=control.dataset.action;if(!['section-window','section-go','section-find','section-add','section-remove','section-up','section-down'].includes(name))return false;
  const e=record();if(!e)return true;position(e);
  if(name==='section-find'){
   const query=search.trim().toLocaleLowerCase(),from=query===lastSearch?offset+1:0;let found=-1;
   if(query)for(let i=0;i<e.sections.length;i++){const index=(from+i)%e.sections.length;if(e.sections[index].title.toLocaleLowerCase().includes(query)){found=index;break;}}
   if(found<0){control.closest('.record-section-navigation').querySelector('[data-section-search-status]').textContent=text(query?'noMatch':'enterHeading');return true;}
   lastSearch=query;choose(e,found);state.recordSection=null;focus={id:first,reading:state.recordReading};render();return true;
  }
  if(name==='section-window'||name==='section-go'){
   let next=offset+(control.dataset.direction==='previous'?-size:size);
   if(name==='section-go'){const input=control.closest('.record-sections').querySelector('[data-section-position]');if(!input.reportValidity())return true;next=Number(input.value)-1;}
   choose(e,next);state.recordSection=null;focus={id:first,reading:state.recordReading};render();return true;
  }
  if(state.recordReading)return true;
  const sections=editableRecord(state.book,e.id).sections,index=sections.findIndex(s=>s.id===control.dataset.id);let next=index;
  if(name==='section-add'){sections.push({id:crypto.randomUUID(),title:text('new'),body:''});next=sections.length-1;}
  else if(index<0)return true;
  else if(name==='section-remove'){if(proseText(sections[index].body)&&!confirm(text('confirmRemove')))return true;sections.splice(index,1);next=Math.min(index,sections.length-1);}
  else{next=index+(name==='section-up'?-1:1);if(next<0||next>=sections.length)return true;[sections[index],sections[next]]=[sections[next],sections[index]];}
  const updated=record();if(next<offset||next>=offset+size)choose(updated,Math.floor(Math.max(0,next)/size)*size);else position(updated);
  focus={id:sections[next]?.id??null,select:name==='section-add'};dirty(e.id);render();return true;
 }
 function bind(){
  if(!focus)return;const target=focus.reading?document.getElementById(sectionAnchor({id:focus.id})):document.querySelector('[data-writing-heading="'+focus.id+'"]');
  const node=target??document.querySelector('[data-action="section-add"]');node?.focus({preventScroll:true});node?.scrollIntoView({block:'nearest'});if(focus.select)target?.select();focus=null;
 }
 return {view,input,action,bind};
}
