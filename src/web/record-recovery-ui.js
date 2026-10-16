import {reconcileRecords} from './record-merge.js';
import {recoveryValuePager} from './record-recovery-value.js';
import {appendOnlyAttempt,validAttempt} from './attempt-model.js';
import {attemptView} from './attempt-view.js';

import {t} from './i18n/index.js';
const text=(key,args)=>t('recordRecovery',key,args);

export function recordRecoveryUI({esc}){
  let active=false,cancelActive=null;
  const html=(key,args)=>esc(text(key,args));
  const dialog=document.createElement('dialog');
  dialog.className='record-recovery';dialog.setAttribute('aria-labelledby','record-recovery-title');document.body.append(dialog);
  const attemptConflict=item=>JSON.parse(item.key).at(-1)==='attempt';
  const preview=(value,item,key)=>attemptConflict(item)&&validAttempt(value)?attemptView(value,esc,{message:(key,args)=>t('attempts',key,args)}):`<div data-conflict-preview="${key}"></div>`;
  const version=(key,label,value,item,i)=>{
    const disabled=attemptConflict(item)&&key==='mine'&&!appendOnlyAttempt(item.stored,value);
    return `<section class="record-conflict-version"><label><input type="radio" name="record-choice-${i}" value="${key}" ${disabled?'disabled':''}> ${esc(label)}</label>${preview(value,item,key)}</section>`;
  };
  async function review({changes,book,recovering=false}){
    if(active)throw new Error(text('finishCurrent'));
    active=true;
    // Both inputs are detached API/checkpoint values, not the active editor.
    let plan;try{plan=reconcileRecords(changes,book.entries,{message:text,owned:true});}catch(error){active=false;throw error;}
    const previousFocus=document.activeElement,decisions=new Map(),combined=new Map(),pagers=new Map();let position=0,activeItem=null;
    dialog.innerHTML=`<h2 id="record-recovery-title">${html(recovering?'recoverTitle':'reviewTitle')}</h2>
      <p>${html(recovering?'recoverDescription':'reviewDescription')}</p>
      <div class="record-merge-summary">${plan.summaries.map(item=>`<section><h3>${esc(item.title)}</h3><p><strong>${html('yourChanges')}</strong> ${esc(item.local.join(', ')||text('none'))}</p>${item.remote.length?`<p><strong>${html('savedChanges')}</strong> ${esc(item.remote.join(', '))}</p>`:''}</section>`).join('')}</div>
      ${plan.conflicts.length?'':`<p>${html('noConflicts')}</p>`}
      <div data-conflict-window></div>
      <p class="record-recovery-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="button" data-recovery="cancel">${html('cancel')}</button><button class="button primary" data-recovery="apply">${html('continueEditing')}</button></div>`;
    function showConflict(){
      const host=dialog.querySelector('[data-conflict-window]'),descriptor=plan.conflicts[position],i=position;
      const item=descriptor?{key:descriptor.key,label:descriptor.label,recordTitle:descriptor.recordTitle,...Object.fromEntries(['base','mine','stored'].map(version=>[version,plan.inspect(descriptor.key,version)]))}:null;
      activeItem=item;pagers.clear();
      if(!item){host.innerHTML='';return;}
      const button=(label,action,disabled=false)=>`<button type="button" class="button" data-recovery="${action}" ${disabled?'disabled':''}>${html(label)}</button>`;
      host.innerHTML=(plan.conflicts.length>1?`<nav class="record-conflict-navigation" aria-label="${html('navigation')}"><p role="status">${html('progress',{current:i+1,total:plan.conflicts.length,chosen:decisions.size})}</p><div class="inline-actions">${button('previous','previous',i===0)}${button('next','next',i===plan.conflicts.length-1)}${button('nextUnresolved','unresolved',decisions.size===plan.conflicts.length)}</div></nav>`:'')+`<fieldset class="record-conflict"><legend tabindex="-1">${esc(plan.summaries.length>1?text('fieldPath',{name:item.recordTitle,field:item.label}):item.label)}</legend>
        ${attemptConflict(item)?'<p>'+esc(t('attempts','conflict'))+'</p>':''}
        <div class="record-conflict-versions">${[['mine',text('yourVersion'),item.mine],['stored',text('savedVersion'),item.stored]].map(([key,label,value])=>version(key,label,value,item,i)).join('')}</div>
        <details><summary>${html('baseVersion')}</summary>${preview(item.base,item,'base')}</details>
        ${typeof item.mine==='string'&&typeof item.stored==='string'&&['body','title','caption','alt','transcript','author'].includes(JSON.parse(item.key).at(-1))?`<div class="record-combine"><label><input type="radio" name="record-choice-${i}" value="combined"> ${html('combine')}</label><div data-combined-editor></div></div>`:''}
        ${item.stored===undefined?'<p>'+html('restorePrivate')+'</p>':''}
      </fieldset>`;
      const chosen=decisions.get(item.key);if(chosen)host.querySelector('[value="'+chosen+'"]').checked=true;
      for(const node of host.querySelectorAll('[data-conflict-preview]')){
        const key=node.dataset.conflictPreview;const pager=recoveryValuePager(item[key],book,{message:text,field:JSON.parse(item.key).at(-1)});pagers.set(key,pager);showValue(node,pager.page());
      }
      showCombined();
    }
    function showValue(node,page){
      node.innerHTML='<pre></pre>'+(page.previous||page.next?`<nav class="record-value-navigation" aria-label="${html('valueNavigation')}"><p role="status">${html('valuePart',{number:page.number})}</p><div class="inline-actions"><button type="button" class="button" data-value-page="previous" ${page.previous?'':'disabled'}>${html('valuePrevious')}</button><button type="button" class="button" data-value-page="next" ${page.next?'':'disabled'}>${html('valueNext')}</button></div></nav>`:'');
      const content=node.querySelector('pre');content.textContent=page.text;
      if(page.previous||page.next)content.tabIndex=0;
    }
    function showCombined(){
      const host=dialog.querySelector('[data-combined-editor]');if(!host)return;
      host.hidden=decisions.get(activeItem.key)!=='combined';if(host.hidden||host.firstChild)return;
      const input=document.createElement('textarea');input.dataset.combined=position;input.setAttribute('aria-label',text('combinedLabel',{field:activeItem.label}));input.value=combined.get(activeItem.key)??activeItem.mine;host.append(input);
    }
    function capture(){
      const item=plan.conflicts[position];if(!item)return;
      const selected=dialog.querySelector('[name="record-choice-'+position+'"]:checked');if(selected)decisions.set(item.key,selected.value);
      const input=dialog.querySelector('[data-combined]');if(input)combined.set(item.key,input.value);
      const status=dialog.querySelector('.record-conflict-navigation [role="status"]');if(status)status.textContent=text('progress',{current:position+1,total:plan.conflicts.length,chosen:decisions.size});
      const unresolved=dialog.querySelector('[data-recovery="unresolved"]');if(unresolved)unresolved.disabled=decisions.size===plan.conflicts.length;
      showCombined();
    }
    showConflict();
    return new Promise(resolve=>{
      function finish(result){dialog.close();dialog.innerHTML='';dialog.onchange=null;dialog.oninput=null;dialog.onclick=null;dialog.oncancel=null;pagers.clear();activeItem=null;active=false;cancelActive=null;previousFocus?.focus();resolve(result);}
      cancelActive=()=>finish(null);
      dialog.onchange=capture;dialog.oninput=capture;
      dialog.oncancel=event=>{event.preventDefault();finish(null);};
      dialog.onclick=event=>{
        const valueButton=event.target.closest('[data-value-page]');
        if(valueButton){
          const node=valueButton.closest('[data-conflict-preview]'),action=valueButton.dataset.valuePage,pager=pagers.get(node.dataset.conflictPreview);showValue(node,pager[action]());
          const same=node.querySelector(`[data-value-page="${action}"]:not(:disabled)`);(same??node.querySelector('[data-value-page]:not(:disabled)'))?.focus();return;
        }
        const action=event.target.closest('[data-recovery]')?.dataset.recovery;
        if(action==='cancel')return finish(null);
        if(['previous','next','unresolved'].includes(action)){
          capture();
          if(action==='unresolved'){const after=plan.conflicts.findIndex((item,i)=>i>position&&!decisions.has(item.key));position=after>=0?after:plan.conflicts.findIndex(item=>!decisions.has(item.key));}
          else position+=action==='previous'?-1:1;
          position=Math.max(0,Math.min(position,plan.conflicts.length-1));showConflict();dialog.querySelector('.record-conflict legend')?.focus();return;
        }
        if(action!=='apply')return;
        capture();
        const choices=new Map();
        for(const [i,item] of plan.conflicts.entries()){
          const selected=decisions.get(item.key);
          if(!selected){position=i;showConflict();const error=dialog.querySelector('[role=alert]');error.hidden=false;error.textContent=text('chooseAll');dialog.querySelector(`[name="record-choice-${i}"]`).focus();return;}
          choices.set(item.key,{version:selected,...(selected==='combined'?{value:combined.get(item.key)}:{})});
        }
        finish(plan.resolveVersions(choices));
      };
      dialog.showModal();dialog.querySelector('[data-recovery=cancel]').focus();
    });
  }
  return {review,close(){cancelActive?.();dialog.close();dialog.innerHTML='';}};
}
