import {materialReference} from './material-reference.js';
import {sampleSourceRoles} from './sample-result-references.js';
import {updateSampleNumericFields} from './sample-result-entry.js';
import {NUMBER_REPRESENTATIONS} from './numeral-context.js';
import {sampleScalarLimit} from './sample-result-format.js';

const labels = {method:'methodRecord',calibration:'calibrationSource',evidence:'supportingEvidence',reading:'readingSource'};

export function sampleSourceFields(provenance = {}, {esc,tr,editable}) {
  if (!editable && !Object.keys(provenance).length) return '';
  return `<details data-lab-sources ${editable?'data-editable':''} ${Object.keys(provenance).length?'open':''}>
    <summary>${esc(tr('resultSources'))}</summary>
    <input type="hidden" name="provenance" value="${esc(JSON.stringify(provenance))}">
    <div data-lab-source-list></div><div data-lab-source-picker></div><p role="alert" data-lab-source-error></p>
    </details>`;
}

export function bindSampleSources(form,{state,api,esc,field,tr,scope}) {
  const root = form.querySelector('[data-lab-sources]'), dialog = form.closest('dialog');
  const context = scope(), workspaceId = state.book.id, editable = root.hasAttribute('data-editable');
  const list = root.querySelector('[data-lab-source-list]'), host = root.querySelector('[data-lab-source-picker]');
  const error = root.querySelector('[data-lab-source-error]'), saved = form.elements.provenance;
  const sources = JSON.parse(saved.value), titles = {};
  const guard = () => {
    if (!root.isConnected || !dialog.open || state.page!=='laboratory' || state.access?.locked ||
        state.storageUnavailable || scope()!==context || state.book.id!==workspaceId) throw new DOMException('','AbortError');
  };
  const call = (name,data,options) => api('/api/research/materials/'+name,data,{...options,adopt:false});
  const btn = (action,label,attrs='') => `<button type="button" class="button" data-source-action="${action}" ${attrs}>${esc(label)}</button>`;
  const address = source => source.ref.revision.slice(0,12)+(source.cell?' · '+tr('cellAddress',{page:source.cell.page+1,row:source.cell.row+1,column:source.cell.column+1}):'');
  let picker,records,controller,request=0,activeRole,sourceKind,ref,columns;
  function close() {
    request++; controller?.abort(); records?.stop(); picker?.dispose(); picker=null;
    host.replaceChildren(); error.textContent=''; activeRole=null;
  }
  function draw() {
    list.innerHTML=sampleSourceRoles.filter(role=>editable||sources[role]).map(role=>{
      const source=sources[role], actions=[];
      if(source)actions.push(btn('inspect',tr('inspectSource')),editable?btn('unlink',tr('unlinkSource')):'');
      if(editable){
        if(role==='reading')actions.push(btn('choose-measurement',tr('chooseMeasurement')),btn('choose-cell',tr('chooseCell')));
        else if(role==='method')actions.push(btn('choose-record',tr('chooseSource')));
        else actions.push(btn('choose-record',tr('chooseRecord')),btn('choose-material',tr('chooseMaterial')));
      }
      return `<fieldset data-source-role="${role}"><legend>${esc(tr(labels[role]))}</legend>${source?`<p>${titles[role]?esc(titles[role])+' · ':''}<code>${esc(address(source))}</code></p>`:''}<div class="inline-actions">${actions.join('')}</div></fieldset>`;
    }).join('');
    if(editable){
      const bound=!!sources.reading;
      form.elements.unit.labels[0].textContent=bound?tr(form.elements.unit.value?'sourceUnit':'unitlessSource'):tr('unit');
      for(const key of ['value','unit'])form.elements[key].readOnly=bound;
      for(const key of ['kind','valueRepresentation','valuePrecision'])form.elements[key].disabled=bound;
      updateSampleNumericFields(form.elements.value);
      if(bound)form.elements.valueRadix.disabled=true;
    }
  }
  function replace(role,source,detail) {
    if(source){sources[role]=source;titles[role]=detail.title;}
    else {delete sources[role];delete titles[role];}
    if(role==='reading'&&source){
      const scalar=detail.value,f=form.elements;
      f.kind.value='numeric';f.value.value=scalar.spelling;f.unit.value=detail.unit;
      f.valueRepresentation.value=scalar.representation;f.valueRadix.value=String(scalar.radix);f.valuePrecision.value=scalar.precision;
    }
    saved.value=JSON.stringify(sources);saved.dispatchEvent(new Event('input',{bubbles:true}));
    close();draw();list.querySelector(`[data-source-role="${role}"] button`)?.focus();
  }
  async function resolve(role,source,accept) {
    controller?.abort();controller=new AbortController();
    const token=++request;
    const result=await api('/api/laboratory/read/result-source',{workspaceId,role,source},{adopt:false,signal:controller.signal});
    guard();if(token!==request)return;
    if(accept)replace(role,source,result);else{titles[role]=result.title;draw();}
  }
  async function choose(role,kind) {
    close();activeRole=role;sourceKind=kind;const token=request;
    if(kind==='record'){
      const {researchTargetPicker}=await import('./research-target-picker.js');
      guard();if(token!==request)return;
      records=researchTargetPicker({state,api,esc,field,active:()=>state.page==='laboratory',excludeId:()=>null});
      records.open({root:host,recordsOnly:true,title:tr(labels[role]),onCancel:close,
        onChoose:async(item,{signal,stillCurrent})=>{
          const pinned=await call('pin',{id:item.id,expectedRevision:item.revision},{signal});
          if(stillCurrent())await resolve(role,{ref:materialReference(pinned)},true);
        }});
      return;
    }
    const {materialSourcePicker}=await import('./material-source-picker.js');
    guard();if(token!==request)return;
    host.innerHTML=`<div data-material-picker><input type="hidden" data-value></div>${btn('accept',tr(kind==='dataset'?'browseColumns':'useSource'))}${btn('cancel',tr('cancel'))}<div data-cell-picker></div>`;
    picker=materialSourcePicker({root:host.firstElementChild,call,esc,field,guard,recordId:null,scope:'all',kind,
      label:tr(kind==='dataset'?'chooseCell':kind==='analysis'?'chooseMeasurement':'chooseMaterial'),id:'sample-analysis-source',optional:true});
    host.querySelector('[data-scope]').closest('.field').hidden=true;
    await picker.ready;
  }
  async function browse(operation,offset=0) {
    const token=++request;
    controller?.abort();controller=new AbortController();
    const cellHost=host.querySelector('[data-cell-picker]');
    const column=Number(cellHost.querySelector('[data-cell-column]')?.value);
    const data=operation==='schema'?{ref,offset,limit:16}:{ref,page:offset,columnOffset:column,columnLimit:1};
    if(operation==='rows')cellHost.querySelector('[data-cell-rows]').replaceChildren();
    else cellHost.replaceChildren();
    const result=await call(operation,data,{signal:controller.signal});
    guard();if(token!==request)return;
    if(operation==='schema'){
      columns=result;
      const options=result.items.map((item,i)=>`<option value="${offset+i}" ${NUMBER_REPRESENTATIONS.includes(item.representation)?'':'disabled'}>${esc(item.name)}${item.unit?' ('+esc(item.unit)+')':''}</option>`).join('');
      cellHost.innerHTML=field(esc(tr('datasetColumn')),`<select data-cell-column>${options}</select>`)+
        (offset?btn('columns',tr('previous'),`data-offset="${Math.max(0,offset-16)}"`):'')+
        (result.next!==null?btn('columns',tr('next'),`data-offset="${result.next}"`):'')+`<div data-cell-rows></div>`;
      if(cellHost.querySelector('[data-cell-column]').value!=='')await browse('rows');
      return;
    }
    const col=columns.items[column-columns.offset];
    const opts=result.rows.map((row,index)=>{
      const value=row.cells[0], retained=col?.resourcePolicy&&value?.format==='dataset-cell'&&value.characters<=sampleScalarLimit;
      const unavailable=row.excluded || (typeof value!=='string'&&!retained) || !value ||
        ['absent','null'].includes(row.valueKinds?.[0]) || col?.missing?.some(item=>item.value===value);
      return `<option value="${index}" ${unavailable?'disabled':''}>${esc(String(row.order??index+1))} · ${esc(typeof value==='string'?value.slice(0,128):'…')}</option>`;
    });
    cellHost.querySelector('[data-cell-rows]').innerHTML=field(esc(tr('datasetRow')),`<select data-cell-row>${opts.join('')}</select>`)+
      (offset?btn('rows',tr('previous'),`data-offset="${offset-1}"`):'')+
      (offset+1<result.pages?btn('rows',tr('next'),`data-offset="${offset+1}"`):'')+
      btn('use-cell',tr('useSource'),`data-page="${result.page}"`);
  }
  async function act(button){
    guard();error.textContent='';
    const action=button.dataset.sourceAction,role=button.closest('[data-source-role]')?.dataset.sourceRole;
    if(action==='cancel'){close();return;}
    if(action==='inspect'){await resolve(role,sources[role],false);return;}
    if(!editable)return;
    if(action==='unlink'){replace(role,null);return;}
    if(action.startsWith('choose-')){await choose(role,{'choose-cell':'dataset','choose-measurement':'analysis','choose-record':'record','choose-material':null}[action]);return;}
    if(action==='accept'){
      const value=picker.values()[0];if(!value)throw Error(tr('selectSourceFirst'));
      ref=materialReference({...value,workspaceId:value.workspaceId??workspaceId});
      if(sourceKind==='dataset')await browse('schema');else await resolve(activeRole,{ref},true);
    }else if(action==='columns'||action==='rows')await browse(action==='columns'?'schema':'rows',Number(button.dataset.offset));
    else if(action==='use-cell'){
      const row=host.querySelector('[data-cell-row]').value,column=host.querySelector('[data-cell-column]').value;
      if(row===''||column==='')throw Error(tr('selectSourceFirst'));
      await resolve('reading',{ref,cell:{page:Number(button.dataset.page),row:Number(row),column:Number(column)}},true);
    }
  }
  function showError(e){
    if(root.isConnected && e.name!=='AbortError')error.textContent=e.code==='LAB_INVALID'&&activeRole==='reading'?tr('invalidSourceReading'):e.message;
  }
  root.addEventListener('click',e=>{const b=e.target.closest('[data-source-action]');if(b){e.preventDefault();e.stopPropagation();void act(b).catch(showError);}});
  root.addEventListener('change',e=>{
    if(e.target.matches('[data-cell-column]'))void browse('rows').catch(showError);
    if(e.target.closest('[data-material-picker]')){request++;controller?.abort();host.querySelector('[data-cell-picker]').replaceChildren();ref=null;}
  });
  dialog.addEventListener('close',close,{once:true});draw();
}
