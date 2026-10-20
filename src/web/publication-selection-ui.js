import {websiteContext} from './website-context.js';
import {publicationErrorView} from './publication-error-view.js';
import {publicationText} from './publication-review.js';
import {readPublicationChoice,publicationChoiceView} from './publication-choice-view.js';
import {publicationReferencesView} from './publication-references-ui.js';
import {editionRevisionKey,editionAvailabilityKey} from './publication-selection.js';

import {publicationEditionSelectionClient} from './publication-edition-selection-client.js';

export function publicationSelectionUI({state,api,esc,showDialog}){
 const text=(key,values)=>esc(publicationText(key,values));
 let session=null,generation=0;
 const current=s=>s&&s===session&&s.generation===generation&&s.context===websiteContext(state)&&s.route===location.hash&&document.querySelector('#dialog[open] #edition-selection');
 const button=(key,action,disabled=false)=>`<button type="button" class="button" data-action="edition-${action}"${disabled?' disabled':''}>${text(key)}</button>`;
 function status(s,key){if(current(s)){const node=document.querySelector('[data-edition-checkpoint]');if(node)node.textContent=publicationText(key);}}
 async function remember(s){
  clearTimeout(s.timer);if(!current(s)||!s.loaded)return;
  const changes=new Map(),put=(collection,id,value)=>changes.set(collection+':'+id,{collection,id,value});
  s.open=new Set([...document.querySelectorAll('[data-edition-record][open]')].map(el=>el.dataset.editionRecord));
  for(const box of document.querySelectorAll('[data-edition-record]')){
   const item=s.items.find(r=>r.id===box.dataset.editionRecord),choice=readPublicationChoice(box,item),value=JSON.stringify(choice)===JSON.stringify(item.choice)?null:choice;
   if(value)s.choices.set(item.id,value);else s.choices.delete(item.id);put('records',item.id,value);
  }
  for(const box of document.querySelectorAll('[data-edition-history]')){
   const item=[...s.references.values()].flatMap(v=>v.items).find(r=>r.record&&editionRevisionKey(r.target)===box.dataset.editionHistory),choice=readPublicationChoice(box,item.record),value=choice.include?choice:null;
   if(value)s.history.set(box.dataset.editionHistory,value);else s.history.delete(box.dataset.editionHistory);put('history',box.dataset.editionHistory,value);
  }
  for(const box of document.querySelectorAll('[data-edition-reference]')){
   const recordId=box.closest('[data-edition-references]').dataset.editionReferences,reference=s.references.get(recordId);
   const item=reference.items.find(r=>editionAvailabilityKey({recordId,target:r.target})===box.dataset.editionReference),statement=box.querySelector('[data-edition-statement]').value.trim(),value=statement?{recordId,target:item.target,statement}:null;
   if(value)s.availability.set(box.dataset.editionReference,value);else s.availability.delete(box.dataset.editionReference);put('availability',box.dataset.editionReference,value);
  }
  status(s,'selectionSaving');await s.client.save([...changes.values()]);status(s,'selectionSaved');
 }
 async function retained(s,keys){for(const item of await s.client.read(keys)){const map=s[item.collection==='records'?'choices':item.collection];if(item.value)map.set(item.id,item.value);else map.delete(item.id);}}
 async function references(s,{recordId,owner=recordId,root=recordId,revision,title,offset=0,back=false}){
  const request=++s.request;
  if(revision)await retained(s,[{collection:'history',id:editionRevisionKey({id:recordId,revision})}]);
  const result=await api('/api/publication-references',{source:s.source,recordId,...(revision?{revision}:{}),choice:revision?s.history.get(editionRevisionKey({id:recordId,revision})):s.choices.get(recordId),offset},{adopt:false});
  if(!current(s)||request!==s.request)return;
  // Only active reference windows and their choices stay in browser memory.
  // Back reloads a saved page rather than retaining its prose and selectors.
  const trail=s.focus.get(root)??[];for(const previous of trail)if(previous.owner!==owner)s.references.delete(previous.owner);
  s.references.set(owner,result);if(!back&&trail.at(-1)?.owner!==owner)trail.push({owner,recordId,revision,title,offset});else if(trail.length)trail.at(-1).offset=offset;s.focus.set(root,trail);
  s.client.forget();s.history.clear();s.availability.clear();
  const keys=s.items.map(item=>({collection:'records',id:item.id}));for(const [key,window] of s.references)for(const item of window.items){keys.push({collection:'availability',id:editionAvailabilityKey({recordId:key,target:item.target})});if(item.record)keys.push({collection:'history',id:editionRevisionKey(item.target)});}
  await retained(s,keys);if(!current(s)||request!==s.request)return;draw(s);
  const view=document.querySelector('[data-edition-references="'+owner+'"]');view.tabIndex=-1;view.focus();
 }
 function row(item){
  const c=session.choices.get(item.id)??item.choice,focus=session.focus.get(item.id)?.at(-1)??{owner:item.id,recordId:item.id};
  return '<details class="panel" data-edition-record="'+item.id+'" data-edition-owner="'+item.id+'"'+(session.open.has(item.id)?' open':'')+'><summary>'+esc(item.title)+'</summary><p class="muted">'+esc(item.notebook)+'</p>'+publicationChoiceView(item,c,esc)+publicationReferencesView(focus.owner,session.references.get(focus.owner),{history:session.history,availability:session.availability,esc,rootId:item.id,originalId:focus.recordId,revision:focus.revision,title:focus.title})+'</details>';
 }
 function shell(){showDialog(`<h2 id="dialog-title">${text('selectionTitle')}</h2><div id="edition-selection" class="edition-selection">${text('loading')}</div><div class="dialog-actions">${button('selectionCancel','cancel')}${button('selectionDiscard','discard')}${button('selectionPrepare','prepare',true)}</div>`);}
 function draw(s){
  const view=document.getElementById('edition-selection');
  view.innerHTML=`<p>${text('selectionGuidance')}</p><p class="muted" role="status" data-edition-checkpoint>${text('selectionSaved')}</p><p>${text('selectionChartBoundary')}</p><details><summary>${text('selectionPrivacy')}</summary><p>${text('selectionPrivacyDetail')}</p></details><div class="inline-actions">${button('selectionPrevious','previous',s.offset===0)}<span role="status">${text('page',{number:s.offset/20+1})}</span>${button('selectionNext','next',s.next===null)}</div>${s.items.length?s.items.map(row).join(''):`<p>${text('selectionNoRecords')}</p>`}`;
  document.querySelector('[data-action="edition-prepare"]').disabled=false;
 }
 async function load(s,offset){
  const request=++s.request;
  document.querySelector('[data-action="edition-prepare"]').disabled=true;
  for(const button of document.querySelectorAll('#edition-selection button'))button.disabled=true;
  const cursor=s.cursors.get(offset)??null;
  const result=await api('/api/publication-selection',{source:s.source,offset,cursor},{adopt:false});if(!current(s)||request!==s.request)return;
  s.client.forget();for(const map of [s.choices,s.history,s.availability,s.references,s.focus])map.clear();
  await retained(s,result.items.map(item=>({collection:'records',id:item.id})));if(!current(s)||request!==s.request)return;
  s.items=result.items;s.offset=result.offset;s.next=result.next;
  if(result.next!==null&&result.nextCursor)s.cursors.set(result.next,result.nextCursor);
  s.loaded=true;draw(s);
 }
 async function open(source,prepare){
  clearTimeout(session?.timer);const s=session={client:publicationEditionSelectionClient(api),source:structuredClone(source),prepare,context:websiteContext(state),route:location.hash,generation:++generation,request:0,choices:new Map(),history:new Map(),availability:new Map(),references:new Map(),focus:new Map(),cursors:new Map(),open:new Set(),items:[],offset:0,next:null};
  shell();
  await s.client.open(s.source);if(current(s))await load(s,0);
 }
 function input(el){
  if(!el.dataset.editionChoice&&!el.hasAttribute('data-edition-statement'))return false;
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
  const s=session;status(s,'selectionSaving');clearTimeout(s.timer);s.timer=setTimeout(()=>{if(current(s))remember(s).catch(()=>status(s,'selectionSaveFailed'));},300);
  return true;
 }
 async function action(el){
  if(!el.dataset.action?.startsWith('edition-'))return false;
  const op=el.dataset.action.slice(8),s=session;if(!current(s))return true;
  clearTimeout(s.timer);el.disabled=true;
  for(const control of document.querySelectorAll('#edition-selection input,#edition-selection textarea,#edition-selection button,.dialog-actions button'))control.disabled=true;
  try{
   if(op==='discard'){await s.client.discard();generation++;document.getElementById('dialog').close();return true;}
   await remember(s);if(!current(s))return true;
   if(op==='cancel'){generation++;document.getElementById('dialog').close();return true;}
   if(op==='next'&&s.next!==null||op==='previous'&&s.offset>0){
    await load(s,op==='next'?s.next:s.offset-20);
    if(current(s)){const view=document.getElementById('edition-selection');view.tabIndex=-1;view.focus();}
   }
   if(op==='references')await references(s,{recordId:el.dataset.record,owner:el.dataset.owner,root:el.dataset.root,revision:el.dataset.revision,title:el.dataset.title,offset:Number(el.dataset.offset??0)});
   if(op==='references-back'){const trail=s.focus.get(el.dataset.root);trail?.pop();const focus=trail?.at(-1);if(focus)await references(s,{...focus,root:el.dataset.root,back:true});else draw(s);}
   if(op==='prepare'){
    const edition=s.client.pin();
    // The retained input consumes this exact immutable checkpoint before a job
    // starts. A later draft change never changes an already captured edition.
    generation++;document.getElementById('dialog').close();await s.prepare({...s.source,edition});
   }
  }catch(error){
   if(s===session&&s.context===websiteContext(state)&&s.route===location.hash&&s.loaded){
    if(op==='prepare'&&!document.querySelector('#dialog[open]')){s.generation=++generation;shell();draw(s);}
    else if(current(s))draw(s);
   }
   if(error.code==='PUBLICATION_LINKS'&&current(s)){document.getElementById('edition-selection').insertAdjacentHTML('afterbegin',publicationErrorView(error,esc));return true;}
   throw error;
  }finally{el.disabled=false;if(current(s))for(const control of document.querySelectorAll('.dialog-actions button'))control.disabled=false;}
  return true;
 }
 return {open,input,action};
}
