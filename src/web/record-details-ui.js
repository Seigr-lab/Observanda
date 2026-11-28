import {t} from './i18n/index.js';
import './i18n/catalogues/recordEditors.js';
import {editableRecord} from './workspace-snapshot.js';
import {researchReference} from './record-model.js';
import {researchTargets} from './research-target-presentation.js';
import {recordRelationAddButton,recordRelationEditButton} from './record-relations-ui.js';

export function recordDetailsUI({state,esc,showDialog,notify,navigate}){
  const msg=(key,args)=>t('recordEditors',key,args),text=(key,args)=>esc(msg(key,args));
  const record=()=>editableRecord(state.book,state.selected);
  const targetName=target=>target.workspaceId===state.book.id?researchTargets(state.book).find(item=>item.kind===target.kind&&item.id===target.id):null;
  const button=(label,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${label}</button>`;
  function relations(entry,{selectedEdits=false}={}){
    return `<section class="research-links" aria-label="${text('researchLinks')}"><header><h3>${text('researchLinks')}</h3><div class="inline-actions">${button(text('copyReference'),'record-copy-reference')}${selectedEdits?recordRelationAddButton(esc):''}</div></header>
      ${entry.relations.length?`<ul class="research-link-list">${entry.relations.map(link=>{
        const found=targetName(link.target),other=link.target.workspaceId!==state.book.id;
        return `<li><div><small>${esc(link.type)} &#183; ${esc(t('recordLinks',link.target.kind))}${other?' &#183; '+esc(t('recordLinks','anotherWorkspace')):''} &#183; ${link.target.revision?esc(t('recordLinks','revision',{revision:link.target.revision.slice(0,10)})):text('currentItem')}</small>${button(esc((link.target.revision?link.label:found?.title)||link.label||msg('linkedItem')),'record-link-open',`data-id="${link.id}"`)}${!found&&!other&&!state.recordScope&&!state.workspaceOutline?'<small>'+text('targetUnavailable')+'</small>':''}</div>${selectedEdits?recordRelationEditButton(link,esc):''}</li>`;
      }).join('')}</ul>`:'<p class="muted">'+text('linksEmpty')+'</p>'}
      </section>`;
  }
  async function action(control){
    const name=control.dataset.action;
    if(!name||!state.book)return false;
    if(name==='research-copy-context'){
      const kind=control.dataset.kind??(state.page==='project'?'project':state.page==='entries'&&state.notebook!=='all'?'notebook':'workspace');
      await copyReference({workspaceId:state.book.id,kind,id:kind==='project'?state.project:kind==='notebook'?state.notebook:state.book.id});return true;
    }
    if(!name.startsWith('record-'))return false;
    if(name==='record-copy-reference'&&state.selected){await copyReference({workspaceId:state.book.id,kind:'record',id:state.selected});return true;}
    const entry=record();
    if(!entry)return false;
    if(name==='record-link-open'){const link=entry.relations.find(item=>item.id===control.dataset.id);if(link)await navigate(link.target);return true;}
    if(name==='record-backlink-open'){await navigate({workspaceId:state.book.id,kind:'record',id:control.dataset.id});return true;}
    return false;
  }
  async function copyReference(target){
    const reference=researchReference(target),context=state.storage?.contextId,selected=state.selected,page=state.page;
    const current=()=>context===state.storage?.contextId&&selected===state.selected&&page===state.page&&target.workspaceId===state.book?.id&&!state.access?.locked&&!state.storageUnavailable;
    try{await navigator.clipboard.writeText(reference);if(current())notify(msg('referenceCopied'));}
    catch{if(current())showDialog(`<h2 id="dialog-title">${text('referenceTitle')}</h2><p class="research-reference">${esc(reference)}</p><div class="dialog-actions">${button(text('close'),'close-dialog')}</div>`);}
  }
  return {relations,action};
}
