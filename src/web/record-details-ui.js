import {t} from './i18n/index.js';
import {editableRecord} from './workspace-snapshot.js';
import {researchTargetPicker} from './research-target-picker.js';
import {workflowRole,workflowIssues} from './record-workflow.js';
import {researchKindLabel} from './research-reference.js';
import {RELATION_TYPES,researchTargets,researchReference,parseResearchReference} from './record-model.js';
import {recordRelationAddButton,recordRelationEditButton} from './record-relations-ui.js';

export function recordDetailsUI({state,esc,field,dirty,render,showDialog,notify,navigate,api}){
  const record=()=>editableRecord(state.book,state.selected);
  const targetName=target=>target.workspaceId===state.book.id?researchTargets(state.book).find(item=>item.kind===target.kind&&item.id===target.id):null;
  const button=(label,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${label}</button>`;
  function contributors(entry){
    return `<section class="research-people" aria-label="Contributors"><header><h3>Contributors</h3>${button('Add contributor','record-contributor-add')}</header>
      ${entry.contributors.length?entry.contributors.map((person,index)=>`<div class="contributor-row" data-contributor-row="${person.id}">
        ${field('Name',`<input data-contributor="${person.id}" data-property="name" value="${esc(person.name)}" aria-label="Contributor ${index+1} name" autocomplete="off">`)}
        ${field('Role <small>Optional</small>',`<input data-contributor="${person.id}" data-property="role" value="${esc(person.role)}" placeholder="e.g. Author, analysis, photography" aria-label="Contributor ${index+1} role">`)}
        ${button('Remove','record-contributor-remove',`data-id="${person.id}" aria-label="Remove contributor ${index+1}"`)}</div>`).join(''):'<p class="muted">Credit everyone who contributed to this record.</p>'}</section>`;
  }
  function relations(entry,{readonly=false,selectedEdits=false}={}){
    return `<section class="research-links" aria-label="Research links"><header><h3>Research links</h3><div class="inline-actions">${button('Copy record reference','record-copy-reference')}${selectedEdits?recordRelationAddButton(esc):readonly?'':button('Link research','record-link-add')}</div></header>
      ${entry.relations.length?`<ul class="research-link-list">${entry.relations.map(link=>{
        const found=targetName(link.target),other=link.target.workspaceId!==state.book.id;
        return `<li><div><small>${esc(link.type)} &#183; ${esc(researchKindLabel(link.target.kind))}${other?' &#183; '+esc(t('recordLinks','anotherWorkspace')):''}${link.target.revision?' &#183; Retained revision '+link.target.revision.slice(0,10):' &#183; Current item'}</small>${button(esc((link.target.revision?link.label:found?.title)||link.label||'Linked item'),'record-link-open',`data-id="${link.id}"`)}${!found&&!other&&!state.recordScope&&!state.workspaceOutline?'<small>Target unavailable. The reference is retained.</small>':''}</div>${selectedEdits?recordRelationEditButton(link,esc):readonly?'':button('Remove','record-link-remove',`data-id="${link.id}" aria-label="Remove link to ${esc(found?.title||link.label)}"`)}</li>`;
      }).join('')}</ul>`:'<p class="muted">Connect observations, experiments and conclusions to the work they build on.</p>'}
      </section>`;
  }
  const targets=researchTargetPicker({state,api,esc,field,showDialog});
  let linkRole=null;
  function picker(role=null){
    linkRole=role;
    targets.open({recordType:role==='run-of'?'non-run':role==='follows-run'?'run':'all',recordsOnly:!!role,onChoose:choose,controls:`${field('Relationship',`<input id="research-relation-type" list="research-relation-types" value="${esc(workflowRole(role)?.label??'Related to')}"><datalist id="research-relation-types">${RELATION_TYPES.map(type=>`<option value="${esc(type)}"></option>`).join('')}</datalist>`)}
      ${field('Reference version','<select id="research-link-version"><option value="current">Current item</option><option value="exact">Exact saved record revision</option></select>')}<p class="muted">Use an exact revision for the method a run followed. Later edits will not change that reference.</p>
<details><summary>Link to another workspace</summary><p>Paste a reference copied from that workspace. Opening the link will ask you to open and unlock its workspace.</p>${field('Observanda reference','<input id="research-external-reference" placeholder="observanda://&#8230;" spellcheck="false">')}${field('Label','<input id="research-external-label" placeholder="Name of the linked research">')}${button('Add reference','record-link-external')}</details>
      <p id="research-link-error" role="alert" hidden></p>`});
    const version=document.querySelector('#research-link-version');
    if(role){version.value=workflowRole(role).exact?'exact':'current';version.disabled=true;document.querySelector('#research-external-reference').closest('details').hidden=true;}
    document.querySelector('#research-target-search').focus();
  }
  function addLink(target,label){
    const type=document.querySelector('#research-relation-type').value.trim();
    if(!type){const error=document.querySelector('#research-link-error');error.hidden=false;error.textContent='Name the relationship.';return;}
    const entry=record();
    if(target.workspaceId===state.book.id&&target.kind==='record'&&target.id===entry.id){notify('Choose another record to link.',true);return;}
    if(entry.relations.some(item=>item.type===type&&researchReference(item.target)===researchReference(target))){notify('That relationship is already linked.');return;}
    const next={id:crypto.randomUUID(),type,target,label,...(linkRole?{role:linkRole}:{})};
    const candidate={...entry,relations:[...entry.relations.filter(l=>linkRole!=='run-of'||l.role!=='run-of'),next]};
    const issues=workflowIssues({...state.book,entries:state.book.entries.map(e=>e.id===entry.id?candidate:e)});
    if(issues.length){notify(issues[0].field,true);return;}
    entry.relations=candidate.relations;dirty();document.querySelector('#dialog').close();targets.stop();render();
  }
  function input(el){
    if(el.dataset.contributor){const person=record().contributors.find(item=>item.id===el.dataset.contributor);if(person&&['name','role'].includes(el.dataset.property)){person[el.dataset.property]=el.value;el.setCustomValidity('');dirty();}return true;}
    if(targets.input(el))return true;
    if(el.id==='research-link-version'){targets.recordsOnly(el.value==='exact');return true;}
    return false;
  }
  async function action(control){
    const name=control.dataset.action;
    if(!name||!state.book)return false;
    if(await targets.action(control))return true;
    if(name==='research-copy-context'){
      const kind=control.dataset.kind??(state.page==='project'?'project':state.page==='entries'&&state.notebook!=='all'?'notebook':'workspace');
      await copyReference({workspaceId:state.book.id,kind,id:kind==='project'?state.project:kind==='notebook'?state.notebook:state.book.id});return true;
    }
    if(!name.startsWith('record-'))return false;
    if(name==='record-copy-reference'&&state.selected){await copyReference({workspaceId:state.book.id,kind:'record',id:state.selected});return true;}
    const entry=record();
    if(!entry)return false;
    if(name==='record-contributor-add'){entry.contributors.push({id:crypto.randomUUID(),name:'',role:''});dirty();render();document.querySelector('.contributor-row:last-child input').focus();return true;}
    if(name==='record-contributor-remove'){entry.contributors=entry.contributors.filter(item=>item.id!==control.dataset.id);dirty();render();return true;}
    if(name==='record-link-add'){picker();return true;}
    if(name==='record-workflow-link'){picker(control.dataset.role);return true;}
    if(name==='record-link-external'){
      const target=parseResearchReference(document.querySelector('#research-external-reference').value);
      if(!target){const error=document.querySelector('#research-link-error');error.hidden=false;error.textContent='Paste a complete Observanda reference.';return true;}
      addLink(target,document.querySelector('#research-external-label').value.trim());return true;
    }
    if(name==='record-link-remove'){entry.relations=entry.relations.filter(item=>item.id!==control.dataset.id);dirty();render();return true;}
    if(name==='record-link-open'){const link=entry.relations.find(item=>item.id===control.dataset.id);if(link)await navigate(link.target);return true;}
    if(name==='record-backlink-open'){await navigate({workspaceId:state.book.id,kind:'record',id:control.dataset.id});return true;}
    return false;
  }
  async function choose(item,{signal,stillCurrent}){
    const target={workspaceId:item.workspaceId,kind:item.kind,id:item.id};
    if(document.querySelector('#research-link-version').value==='exact'){
      if(item.kind!=='record')throw Error('Choose a record for an exact revision.');
      const saved=await api('/api/research/materials/pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});
      if(!stillCurrent())return;
      if(saved.workspaceId!==target.workspaceId||saved.id!==target.id||saved.kind!=='record'||saved.revision!==item.revision)throw Error('The retained revision did not match the selected record. Refresh and try again.');
      target.revision=saved.revision;
    }
    if(stillCurrent())addLink(target,item.title);
  }
  async function copyReference(target){
    const reference=researchReference(target),context=state.storage?.contextId,selected=state.selected,page=state.page;
    const current=()=>context===state.storage?.contextId&&selected===state.selected&&page===state.page&&target.workspaceId===state.book?.id&&!state.access?.locked&&!state.storageUnavailable;
    try{await navigator.clipboard.writeText(reference);if(current())notify('Research reference copied.');}
    catch{if(current())showDialog(`<h2 id="dialog-title">Research reference</h2><p class="research-reference">${esc(reference)}</p><div class="dialog-actions">${button('Close','close-dialog')}</div>`);}
  }
  return {contributors,relations,input,action,sync:targets.sync,stop:targets.stop,validate(){
    const issues=workflowIssues(state.book);if(issues.length)throw new Error(issues[0].field);
    for(const input of document.querySelectorAll('[data-record-field]'))if(!input.reportValidity())throw new Error('Complete the required record fields before saving.');
    for(const input of document.querySelectorAll('[data-contributor][data-property="name"]')){
      input.setCustomValidity(input.value.trim()?'':'Enter a contributor name, or remove this empty row.');
      if(!input.reportValidity())throw new Error('Complete the contributor names before saving.');
    }
  }};
}
