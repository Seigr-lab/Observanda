import {websiteContext} from './website-context.js';
import {publicationErrorView} from './publication-error-view.js';
import {publicationText} from './publication-review.js';
import {readPublicationChoice,publicationChoiceView} from './publication-choice-view.js';
import {publicationReferencesView} from './publication-references-ui.js';
import {emptyEditionSelection,editionRevisionKey,editionAvailabilityKey} from './publication-selection.js';

export function publicationSelectionUI({state,api,esc,showDialog}){
 const text=(key,values)=>esc(publicationText(key,values));
 let session=null,generation=0;
 const current=s=>s&&s===session&&s.generation===generation&&s.context===websiteContext(state)&&s.route===location.hash&&document.querySelector('#dialog[open] #edition-selection');
 const button=(key,action,disabled=false)=>`<button type="button" class="button" data-action="edition-${action}"${disabled?' disabled':''}>${text(key)}</button>`;
 function remember(){
  session.open=new Set([...document.querySelectorAll('[data-edition-record][open]')].map(el=>el.dataset.editionRecord));
  for(const box of document.querySelectorAll('[data-edition-record]')){
   const item=session.items.find(r=>r.id===box.dataset.editionRecord);
   session.choices.set(item.id,readPublicationChoice(box,item));
  }
  for(const box of document.querySelectorAll('[data-edition-history]')){
   const item=[...session.references.values()].flatMap(v=>v.items).find(r=>r.record&&editionRevisionKey(r.target)===box.dataset.editionHistory);
   session.history.set(box.dataset.editionHistory,readPublicationChoice(box,item.record));
  }
  for(const box of document.querySelectorAll('[data-edition-reference]')){
   const recordId=box.closest('[data-edition-references]').dataset.editionReferences,state=session.references.get(recordId);
   const item=state.items.find(r=>editionAvailabilityKey({recordId,target:r.target})===box.dataset.editionReference),statement=box.querySelector('[data-edition-statement]').value.trim();
   if(statement)session.availability.set(box.dataset.editionReference,{recordId,target:item.target,statement});else session.availability.delete(box.dataset.editionReference);
  }
 }
 function row(item){
  const c=session.choices.get(item.id)??item.choice,focus=session.focus.get(item.id)?.at(-1)??{owner:item.id,recordId:item.id};
  return '<details class="panel" data-edition-record="'+item.id+'" data-edition-owner="'+item.id+'"'+(session.open.has(item.id)?' open':'')+'><summary>'+esc(item.title)+'</summary><p class="muted">'+esc(item.notebook)+'</p>'+publicationChoiceView(item,c,esc)+publicationReferencesView(focus.owner,session.references.get(focus.owner),{history:session.history,availability:session.availability,esc,rootId:item.id,originalId:focus.recordId,revision:focus.revision,title:focus.title})+'</details>';
 }
 function shell(){showDialog(`<h2 id="dialog-title">${text('selectionTitle')}</h2><div id="edition-selection" class="edition-selection">${text('loading')}</div><div class="dialog-actions">${button('selectionCancel','cancel')}${button('selectionPrepare','prepare',true)}</div>`);}
 function draw(s){
  const view=document.getElementById('edition-selection');
  view.innerHTML=`<p>${text('selectionGuidance')}</p><p>${text('selectionChartBoundary')}</p><details><summary>${text('selectionPrivacy')}</summary><p>${text('selectionPrivacyDetail')}</p></details><div class="inline-actions">${button('selectionPrevious','previous',s.offset===0)}<span role="status">${text('page',{number:s.offset/20+1})}</span>${button('selectionNext','next',s.next===null)}</div>${s.items.length?s.items.map(row).join(''):`<p>${text('selectionNoRecords')}</p>`}`;
  document.querySelector('[data-action="edition-prepare"]').disabled=false;
 }
 async function load(s,offset){
  const request=++s.request;
  document.querySelector('[data-action="edition-prepare"]').disabled=true;
  for(const button of document.querySelectorAll('#edition-selection button'))button.disabled=true;
  const cursor=s.cursors.get(offset)??null;
  const result=await api('/api/publication-selection',{source:s.source,offset,cursor},{adopt:false});if(!current(s)||request!==s.request)return;
  s.items=result.items;s.offset=result.offset;s.next=result.next;
  if(result.next!==null&&result.nextCursor)s.cursors.set(result.next,result.nextCursor);
  s.loaded=true;draw(s);
 }
 async function open(source,prepare){
  const s=session={source:structuredClone(source),prepare,context:websiteContext(state),route:location.hash,generation:++generation,request:0,choices:new Map(),history:new Map(),availability:new Map(),references:new Map(),focus:new Map(),cursors:new Map(),open:new Set(),items:[],offset:0,next:null};
  shell();
  await load(s,0);
 }
 function input(el){
  if(!el.dataset.editionChoice)return false;
  if(el.dataset.editionChoice==='include')el.closest('[data-edition-owner]').querySelector('[data-edition-parts]').hidden=!el.checked;
  if(el.dataset.editionChoice==='figures'){
   const data=el.closest('[data-edition-owner]').querySelector(`[data-edition-choice="data"][value="${el.value}"]`);data.disabled=!el.checked;if(!el.checked)data.checked=false;
  }
  const owner=el.closest('[data-edition-history]');
  if(owner){
   for(const other of document.querySelectorAll('[data-edition-history="'+owner.dataset.editionHistory+'"]'))if(other!==owner){
    for(const input of owner.querySelectorAll('[data-edition-choice]')){const peer=[...other.querySelectorAll('[data-edition-choice]')].find(p=>p.dataset.editionChoice===input.dataset.editionChoice&&p.value===input.value);if(peer){peer.checked=input.checked;peer.disabled=input.disabled;}}
    other.querySelector('[data-edition-parts]').hidden=owner.querySelector('[data-edition-parts]').hidden;
   }
  }
  return true;
 }
 async function action(el){
  if(!el.dataset.action?.startsWith('edition-'))return false;
  const op=el.dataset.action.slice(8),s=session;if(!current(s))return true;
  if(op==='cancel'){generation++;document.getElementById('dialog').close();return true;}
  remember();el.disabled=true;
  try{
   if(op==='next'&&s.next!==null||op==='previous'&&s.offset>0){
    await load(s,op==='next'?s.next:s.offset-20);
    if(current(s)){const view=document.getElementById('edition-selection');view.tabIndex=-1;view.focus();}
   }
   if(op==='references'){
    const recordId=el.dataset.record,owner=el.dataset.owner??recordId,root=el.dataset.root??recordId,revision=el.dataset.revision,request=++s.request;
    document.querySelector('[data-action="edition-prepare"]').disabled=true;
    for(const control of document.querySelectorAll('#edition-selection input,#edition-selection textarea,#edition-selection button'))control.disabled=true;
    const result=await api('/api/publication-references',{source:s.source,recordId,...(revision?{revision}:{}),choice:revision?s.history.get(editionRevisionKey({id:recordId,revision})):s.choices.get(recordId),offset:Number(el.dataset.offset??0)},{adopt:false});
    if(current(s)&&request===s.request){s.references.set(owner,result);const trail=s.focus.get(root)??[];if(trail.at(-1)?.owner!==owner)trail.push({owner,recordId,revision,title:el.dataset.title});s.focus.set(root,trail);draw(s);const view=document.querySelector('[data-edition-references="'+owner+'"]');view.tabIndex=-1;view.focus();}
   }
   if(op==='references-back'){s.focus.get(el.dataset.root)?.pop();draw(s);}
   if(op==='prepare'){
    const edition={...emptyEditionSelection(),records:[...s.choices.values()],history:[...s.history.values()].filter(c=>c.include),availability:[...s.availability.values()].filter(n=>s.choices.get(n.recordId)?.include!==false)};
    // Close before handing over to a durable preparation or inline preview.
    // A delayed reply never reopens a dialog after the user has left it.
    generation++;document.getElementById('dialog').close();await s.prepare({...s.source,edition});
   }
  }catch(error){
   if(s===session&&s.context===websiteContext(state)&&s.route===location.hash&&s.loaded){
    if(op==='prepare'&&!document.querySelector('#dialog[open]')){s.generation=++generation;shell();draw(s);}
    else if(current(s))draw(s);
   }
   if(error.code==='PUBLICATION_LINKS'&&current(s)){document.getElementById('edition-selection').insertAdjacentHTML('afterbegin',publicationErrorView(error,esc));return true;}
   throw error;
  }finally{el.disabled=false;}
  return true;
 }
 return {open,input,action};
}
