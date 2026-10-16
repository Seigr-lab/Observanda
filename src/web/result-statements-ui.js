import {retainedTableUI,tableText} from './retained-table-ui.js';
import {RESULT_KINDS,validResults,resultStatementsView} from './result-statements.js';
import {atext as a,analysisReferenceField,wireAnalysisFields,assertAnalysisFieldsReady} from './analysis-fields-ui.js';
import {editableRecord} from './workspace-snapshot.js';
import {figureTargets} from './figure-composition.js';
export function resultStatementsUI({state,api,esc,field,showDialog,notify,dirty,render,openReference}){
 let draft=null,context=null,dispose=null,tableUI=null,saving=false;
 const record=()=>editableRecord(state.book,state.selected),identity=()=>state.storage?.contextId+':'+state.selected;
 const guard=()=>{if(context!==identity())throw Error(a('invalid'));};
 const call=(name,data,options)=>api('/api/research/materials/'+name,data,options);
 const button=(label,action,id='')=>`<button type="button" class="button" data-action="result-${action}" data-id="${esc(id)}">${esc(a(label))}</button>`;
 const reference=r=>`<button type="button" class="text-button" data-action="result-reference" data-ref="${esc(JSON.stringify(r))}">${esc(r.label??a('resultSource'))} · ${r.revision.slice(0,12)}</button>`;
 function stop(){tableUI?.stop();tableUI=null;dispose?.();dispose=null;}
 document.getElementById('dialog').addEventListener('close',stop);
 function view({readonly=false}={}){const v=record()?.results;return (readonly?'':button('addResult','add'))+resultStatementsView(v,esc,{message:a,reference,edit:readonly?null:s=>button('editResult','edit',s.id)+button('remove','remove',s.id)});}
 function form(){
  stop();const input=(k,area=false)=>field(esc(a(k==='text'?'statement':k==='title'?'resultTitle':k)),area?`<textarea name="${k}" maxlength="10000" rows="4">${esc(draft[k])}</textarea>`:`<input name="${k}" maxlength="300" value="${esc(draft[k])}">`),select=(k,values)=>field(esc(a(k)),`<select name="${k}">${values.map(v=>`<option value="${v}"${draft[k]===v?' selected':''}>${esc(a(v))}</option>`).join('')}</select>`);
  const figures=field(esc(a('figureTarget')),`<select name="figureId"><option value="">${esc(a('none'))}</option>${figureTargets(record().figures).map(f=>`<option value="${f.id}"${f.id===draft.figureId?' selected':''}>${esc(f.title)}</option>`).join('')}</select>`);
  showDialog(`<h2 id="dialog-title">${esc(a('editResult'))}</h2><form id="result-form"><p>${esc(a('resultHelp'))}</p>${input('title')}${select('kind',RESULT_KINDS)}<div data-result-figure>${figures}</div>${input('text',true)}${select('basis',['authored','retained'])}${analysisReferenceField('resultSource',draft.source,{esc,kind:draft.kind==='table'?'dataset':'analysis'})}<div data-result-table></div>${input('limitations',true)}<div class="dialog-actions">${button('cancel','cancel')}${button('resultSave','save')}</div></form>`);
  const root=document.getElementById('result-form');
  tableUI=retainedTableUI({root:root.querySelector('[data-result-table]'),call,esc,field,guard,notify});
  const loadTable=()=>{if(draft.kind==='table'&&draft.basis==='retained')void tableUI.load(draft.source,draft.table).catch(e=>notify(e.message,true));};
  dispose=wireAnalysisFields(root,{state,api,call,esc,field,guard,recordId:record().id,onReference:async(region,value)=>{draft.source=value;delete draft.table;loadTable();}});
  root.querySelector('[data-analysis-ref]').hidden=draft.basis!=='retained';root.querySelector('[data-result-figure]').hidden=draft.kind!=='figure';
  if(draft.kind==='table')root.querySelector('[data-analysis-ref] legend').textContent=tableText('source');loadTable();
  const change=()=>{assertAnalysisFieldsReady(root);const priorKind=draft.kind;draft.figureId=root.elements.figureId.value;for(const k of ['title','text','kind','basis','limitations'])draft[k]=root.elements[k].value;if((priorKind==='table')!==(draft.kind==='table')){draft.source=null;delete draft.table;}form();};
  root.elements.basis.onchange=change;root.elements.kind.onchange=change;

 }
 async function action(b){
  const name=b.dataset.action;if(!name?.startsWith('result-'))return false;if(saving)return true;
  if(name==='result-reference'){await openReference(JSON.parse(b.dataset.ref));return true;}
  if(name==='result-add'||name==='result-edit'){context=identity();draft=name==='result-add'?{id:crypto.randomUUID(),kind:'conclusion',title:'',text:'',basis:'authored',source:null,limitations:''}:structuredClone(record().results.statements.find(s=>s.id===b.dataset.id));form();}
  if(name==='result-remove'){const next=record().results.statements.filter(s=>s.id!==b.dataset.id);record().results={version:1,statements:next};dirty();render();}
  if(name==='result-cancel')document.getElementById('dialog').close();
  if(name==='result-save'){guard();const root=document.getElementById('result-form');assertAnalysisFieldsReady(root);for(const k of ['title','text','kind','basis','limitations'])draft[k]=root.elements[k].value;draft.source=draft.basis==='retained'?JSON.parse(root.querySelector('[data-ref-value]').value):null;
   if(draft.kind==='table'&&draft.basis==='retained'){saving=true;b.disabled=true;try{draft.table=await tableUI.read();}finally{saving=false;if(b.isConnected)b.disabled=false;}}else delete draft.table;
   if(draft.kind==='figure')draft.figureId=root.elements.figureId.value;else delete draft.figureId;const statements=[...(record().results?.statements??[])],index=statements.findIndex(s=>s.id===draft.id);if(index<0)statements.push(draft);else statements[index]=draft;
   if(!validResults({version:1,statements}))throw Error(a('invalid'));record().results={version:1,statements};dirty();document.getElementById('dialog').close();render();notify(a('resultSaved'));
  }return true;
 }
 return {view,action,stop,reference,refresh(){const host=document.querySelector('[data-result-statements]');if(host)host.innerHTML=view();}};
}
