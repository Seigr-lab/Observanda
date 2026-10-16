import {taskPrerequisitesUI} from './task-prerequisites-ui.js';
import {localTaskDependency,taskDependencyReference} from '../task-prerequisite-model.js';
import {proseText} from '../prose-model.js';
import {calendarTypes,calendarBlank,calendarForm,calendarInput} from './calendar-fields.js';
import {calendarUI} from './calendar-ui.js';
import {moduleEditor} from './workbench.js';
const taskStatuses=[['todo','To do'],['doing','In progress'],['done','Completed'],['cancelled','Cancelled']];
const bookingStatuses=[['confirmed','Confirmed'],['cancelled','Cancelled']];
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
const localValue=value=>{if(!value)return '';const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
export async function createPlanningUI(services){let prerequisites;const addressed=services.state.storage?.researchStorage==='catalogue'&&services.state.storage.researchFormatVersion===21;const editor=await moduleEditor(services,{
 setup(c){if(addressed)prerequisites=taskPrerequisitesUI(services,c);},bind(){prerequisites?.bind();},deactivate(){prerequisites?.stop();},dispose(){prerequisites?.stop();},
 commandRequest:(run,command)=>prerequisites?prerequisites.commandRequest(run,command):run(),
 saveCommand(d){const data={...d.data};if(d.type==='task')delete data.prerequisiteObservations;return {action:d.type+'.save',payload:{id:d.id,expectedRevision:d.expectedRevision,data}};},
 id:'planning',scoped:true,paged:true,label:'Planning',
 listPath:type=>type==='calendar'?'agenda':type,
 itemFields:d=>d?.type==='task'?[{key:'dependencies',type:'task',multiple:true,get:draft=>draft.data.dependencies.filter(value=>localTaskDependency(value,services.state.book.id)).map(value=>taskDependencyReference(value,services.state.book.id).id),query:{moduleId:'planning'}}]:d?.type==='booking'?[{key:'resourceId',type:'resource',query:{kind:'equipment'}}]:d?.type==='event'?[{key:'calendarId',type:'calendar',query:{archived:false,moduleId:'planning'}}]:[],
 types:[...calendarTypes,{id:'task',label:'Tasks',singular:'task',statuses:taskStatuses,empty:'Plan work, assign names, keep checklists and connect prerequisites to your research.'},{id:'booking',label:'Equipment agenda',singular:'booking',statuses:bookingStatuses,empty:'Book equipment from Inventory. Conflicting reservations and maintenance are checked when saving.'}],
 blank:(type,c)=>calendarBlank(type,c)??(type==='task'?{projectId:c.creationScopeId,title:'',description:'',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]}:{projectId:c.creationScopeId,title:'',resourceId:'',startsAt:'',endsAt:'',timeZone:zone(),places:1,kind:'work',status:'confirmed',notes:'',links:[]}),
 card(e,c){
  const d=e.data,{esc}=c;
  if(calendarTypes.some(t=>t.id===e.type))return `<h2>${esc(d.name??d.title)}</h2><p>${esc(e.type==='event'?d.startsAt+' to '+d.endsAt:e.type==='calendar'?(d.archived?'Archived':'Active'):d.enabled?'Included':'Disabled')}</p>`;
  return `<div class="module-item-heading"><h2>${esc(d.title)}</h2><span class="status-badge">${esc((e.type==='task'?taskStatuses:bookingStatuses).find(s=>s[0]===d.status)?.[1])}</span></div>${e.type==='task'?`<p>${esc(proseText(d.description))}</p><dl class="module-facts"><div><dt>Due</dt><dd>${esc(d.dueOn??'Not scheduled')}</dd></div><div><dt>People</dt><dd>${esc(d.assignees.join(', ')||'Unassigned')}</dd></div><div><dt>Checklist</dt><dd>${d.checklist.filter(c=>c.done).length} / ${d.checklist.length}</dd></div><div><dt>Priority</dt><dd>${esc(d.priority)}</dd></div></dl>`:`<p><strong>${esc(c.get(d.resourceId)?.data.name??'Equipment unavailable')}</strong></p><p>${esc(new Date(d.startsAt).toLocaleString())}<br>to ${esc(new Date(d.endsAt).toLocaleString())}</p><small>${esc(zone())} / ${esc(d.kind)} / ${d.places} place(s)</small>`}<div>${c.links(d.links)}</div>`;
 },
 form(d,c){
  const {input,area,select,field,esc,option,button}=c,v=d.data;
  if(calendarTypes.some(t=>t.id===d.type))return calendarForm(d,c);
  if(d.type==='booking'){
   return `<section class="module-block"><h2>Equipment reservation</h2>${c.ownerField()}<div class="form-grid">${input('title','Booking title','text','required maxlength="240"')}${c.itemField('resourceId','Equipment')}${select('kind','Booking type',[['work','Research / work'],['maintenance','Maintenance blackout']])}${select('status','Status',bookingStatuses)}${field('Starts',`<input type="datetime-local" data-local-time="startsAt" value="${localValue(v.startsAt)}" required>`)}${field('Ends',`<input type="datetime-local" data-local-time="endsAt" value="${localValue(v.endsAt)}" required>`)}${input('places','Places required','number','min="1" step="1" required')}</div><p class="muted">Times shown in ${esc(zone())}. Maintenance reserves the equipment&#39;s full capacity.</p>${area('notes','Purpose and preparation notes')}</section>${c.referenceFields()}`;
  }
  return `<section class="module-block"><h2>Task details</h2>${c.ownerField()}${input('title','Task title','text','required maxlength="240"')}<div class="form-grid">${select('status','Status',taskStatuses)}${select('priority','Priority',[['low','Low'],['normal','Normal'],['high','High']])}${input('dueOn','Due date','date')}${field('People (one name per line)',`<textarea rows="2" data-task-people>${esc(v.assignees.join('\n'))}</textarea>`)}</div>${area('description','Work to do')}</section><section class="module-block"><div class="section-bar"><h2>Checklist</h2>${button('Add checklist item','add-check')}</div>${v.checklist.map((item,i)=>`<div class="module-check-item"><input type="checkbox" data-check-id="${item.id}" data-check-property="done" aria-label="Complete checklist item ${i+1}" ${item.done?'checked':''}><input data-check-id="${item.id}" data-check-property="text" aria-label="Checklist item ${i+1}" value="${esc(item.text)}" required>${button('Remove','remove-check',`data-id="${item.id}" aria-label="Remove checklist item ${i+1}"`,'subtle')}</div>`).join('')}</section>${prerequisites?prerequisites.view():`<section class="module-block"><h2>Prerequisites</h2><p class="muted">These tasks must complete first.</p>${v.dependencies.map(id=>`<div class="module-inline">${c.itemLabel(id)}${button('Remove','remove-dependency',`data-id="${id}"`,'subtle')}</div>`).join('')}${c.itemField('dependencies','Add prerequisite')}</section>`}${c.referenceFields()}`;
 },
 input(el,c){
  if(calendarInput(el,c))return true;
  const d=c.current?.data;if(!d)return false;
  if(el.dataset.moduleField==='status')prerequisites?.changed();
  if(el.dataset.moduleField==='dueOn'){d.dueOn=el.value||null;return true;}
  if(el.hasAttribute('data-task-people')){d.assignees=[...new Set(el.value.split('\n').map(v=>v.trim()).filter(Boolean))];return true;}
  if(el.dataset.checkId){const item=d.checklist.find(i=>i.id===el.dataset.checkId);item[el.dataset.checkProperty]=el.type==='checkbox'?el.checked:el.value;prerequisites?.changed();return true;}
  if(el.dataset.localTime){
   const value=el.value,parsed=new Date(value);
   if(value&&Number.isFinite(parsed.getTime())&&localValue(parsed.toISOString())!==value){el.setCustomValidity('This local time does not exist because of a daylight-saving change.');return true;}
   el.setCustomValidity('');d[el.dataset.localTime]=Number.isFinite(parsed.getTime())?parsed.toISOString():'';d.timeZone=zone();return true;
  }return false;
 },
 async action(name,node,c){
  if(await prerequisites?.action(name,node))return;
  const d=c.current.data,id=node.dataset.id;
  if(name==='add-check')d.checklist.push({id:crypto.randomUUID(),text:'',done:false});
  else if(name==='remove-check')d.checklist=d.checklist.filter(i=>i.id!==id);
  else if(name==='remove-dependency')d.dependencies=d.dependencies.filter(i=>i!==id);
  else return;
  c.change();c.draw();
 }
});return calendarUI(services,editor);}
