import {m} from './editor-presentation.js';
import {materialSourcePicker} from '../material-source-picker.js';
import {TABLE_DELIMITERS} from '../tabular-data.js';
import {BOM_COLUMNS,suggestedBOMMapping,mapBOMTable} from './bom-import-model.js';
import {bomLine} from './bom-model.js';

// Import is a separate review dialog. The BOM stays untouched until confirmation.
export async function openBOMImport(c){
 const {state,api,esc,field,showDialog}=c.services,draft=c.current,context=state.storage.contextId,recordId=draft.data.recordId;
 if(!recordId)throw Error(m('chooseBomRecord'));
 if(draft.data.status!=='draft'||draft.data.lines.length||draft.data.source)throw Error(m('emptyDraftBom'));
 let loaded=null,preview=null,picker=null,request=null,disposed=false;
 const guard=()=>{if(disposed||state.storage.contextId!==context||c.current!==draft||draft.data.recordId!==recordId||draft.data.status!=='draft'||draft.data.lines.length||draft.data.source)throw Error(m('bomChanged'));};
 showDialog('<div class="bom-import"><h2 id="dialog-title">'+esc(m('importBill'))+'</h2><form id="bom-import-form">'+
  '<p>'+esc(m('importBomHelp'))+'</p>'+
  '<div data-bom-source><input type="hidden" name="bom-source" data-value value=""></div>'+
  field(esc(m('columnSeparator')),'<select name="bom-delimiter" data-bom-delimiter>'+TABLE_DELIMITERS.map(([value])=>'<option value="'+esc(value)+'">'+esc(m(({auto:'detectDelimiter',',':'comma','\t':'tab',';':'semicolon','|':'pipe'})[value]))+'</option>').join('')+'</select>')+
  '<button type="button" class="button" data-bom-load>'+esc(m('readColumns'))+'</button><p role="status" data-bom-message></p><div data-bom-mapping></div><div data-bom-review></div>'+
  '</form><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(m('cancel'))+'</button><button type="button" class="button primary" data-bom-apply disabled>'+esc(m('addReviewed'))+'</button></div></div>');
 const dialog=document.getElementById('dialog'),root=dialog.querySelector('.bom-import'),load=root.querySelector('[data-bom-load]'),apply=root.querySelector('[data-bom-apply]'),message=root.querySelector('[data-bom-message]'),mappingRoot=root.querySelector('[data-bom-mapping]'),review=root.querySelector('[data-bom-review]');
 const abort=()=>{disposed=true;picker?.dispose();request?.abort();};
 dialog.addEventListener('close',abort,{once:true});
 const report=e=>{if(!disposed&&e.name!=='AbortError')message.textContent=[e.message,...(e.details??[]).map(d=>d.field)].filter(Boolean).join(' ');};
 const invalidate=()=>{preview=null;apply.disabled=true;review.innerHTML='';};
 const clear=()=>{request?.abort();loaded=null;mappingRoot.innerHTML='';invalidate();};
 root.querySelector('[data-bom-delimiter]').addEventListener('change',clear);
 root.querySelector('[data-bom-source]').addEventListener('input',clear);
 const select=(key,label,value,choices)=>field(esc(label),'<select name="bom-map-'+key+'" data-bom-map="'+key+'">'+choices.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>');
 const mapping=()=>Object.fromEntries(BOM_COLUMNS.map(([key])=>{const value=root.querySelector('[data-bom-map="'+key+'"]').value;return [key,value===''?null:Number(value)];}));
 const separator=()=>root.querySelector('[data-bom-reference-separator]').value;
 const reviewMapping=()=>{
  try{
   guard();invalidate();
   if(!loaded)throw Error(m('readColumnsFirst'));
   const mapped=mapBOMTable(loaded.table,mapping(),{referenceSeparator:separator()});
   preview={...mapped,mapping:mapping(),referenceSeparator:separator()};
   const fields=[['row',m('sourceLine')],['references',m('references')],['value',m('value')],['quantity',m('perBuild')],['unit',m('unit')],['dnp','DNP'],['footprint',m('footprint')],['partNumber',m('partNumber')]];
   review.innerHTML='<h3>'+esc(m('reviewComponents'))+'</h3><p>'+esc(m('componentRowSummary',{rows:mapped.lines.length,dnp:mapped.lines.filter(l=>l.dnp).length,excluded:mapped.excluded.length}))+'</p>'+
    '<p>'+esc(m('componentReviewHelp'))+'</p>'+
    (preview.mapping.dnp===null?'<p><strong>'+esc(m('noDnp'))+'</strong></p>':'')+
    (preview.mapping.exclude===null?'<p>'+esc(m('noExclusion'))+'</p>':'')+
    (mapped.unmapped.length?'<p>'+esc(m('unmappedColumns',{columns:mapped.unmapped.join(', ')}))+'</p>':'')+
    '<div class="bom-import-table" tabindex="0" role="region" aria-label="'+esc(m('importedComponents'))+'"><table><thead><tr>'+fields.map(([,label])=>'<th scope="col">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+
    mapped.lines.map(line=>'<tr>'+fields.map(([key,label])=>'<td data-label="'+esc(label)+'">'+esc(key==='dnp'?(line.dnp?m('yes'):m('no')):line[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
    (mapped.excluded.length?'<details><summary>'+esc(m('excludedRows'))+'</summary><ul>'+mapped.excluded.map(r=>'<li>'+esc(m('excludedRow',{row:r.row,references:r.references,value:r.value}))+'</li>').join('')+'</ul></details>':'')+
    '<label class="checkbox"><input type="checkbox" name="bom-reviewed" data-bom-reviewed>'+esc(m('reviewedBom'))+'</label>';
   review.querySelector('[data-bom-reviewed]').addEventListener('change',e=>{apply.disabled=!e.target.checked;});
   message.textContent=m('originalVerified',{name:loaded.name,size:loaded.size});
  }catch(e){report(e);}
 };
 load.addEventListener('click',async()=>{
  clear();load.disabled=true;request=new AbortController();const active=request;
  try{
   guard();const artifact=picker.values()[0];message.textContent=m('readingOriginal');
   const result=await api('/api/modules/bom-source',{artifact,delimiter:root.querySelector('[data-bom-delimiter]').value},{signal:active.signal});
   guard();if(request!==active||active.signal.aborted)return;loaded=result;
   const suggested=suggestedBOMMapping(loaded.table),columns=loaded.table.columns.map(col=>[col.index,col.label]);
   mappingRoot.innerHTML='<h3>'+esc(m('mapColumns'))+'</h3><div class="form-grid">'+BOM_COLUMNS.map(([key])=>select(key,m(({references:'references',value:'valueDescription',quantity:'quantityPerBuild',footprint:'footprintPackage',partNumber:'manufacturerPart',unit:'unit',dnp:'dnp',exclude:'excludeFromBom',notes:'notes'})[key]),suggested[key]??'',[['',key==='unit'?m('useItems'):key==='dnp'?m('allPopulated'):key==='exclude'?m('excludeNone'):m('notMapped')],...columns])).join('')+
    field(esc(m('referenceSeparator')),'<select name="bom-reference-separator" data-bom-reference-separator><option value=",">'+esc(m('comma'))+'</option><option value=";">'+esc(m('semicolon'))+'</option><option value="space">'+esc(m('spaces'))+'</option></select>')+'</div>'+
    '<button type="button" class="button" data-bom-preview>'+esc(m('reviewMapped'))+'</button>';
   mappingRoot.querySelectorAll('select').forEach(el=>el.addEventListener('change',invalidate));
   mappingRoot.querySelector('[data-bom-preview]').addEventListener('click',reviewMapping);
   message.textContent=m('checkMapping');
   mappingRoot.querySelector('select')?.focus();
  }catch(e){report(e);}finally{if(!disposed)load.disabled=false;}
 });
 apply.addEventListener('click',()=>{
  try{
   guard();if(!preview||apply.disabled)return;
   const {table,...original}=loaded;
   draft.data.lines=preview.lines.map(({row,...line})=>({...bomLine(),...line}));
   draft.data.source={version:1,...original,delimiter:table.delimiter,mapping:preview.mapping,referenceSeparator:preview.referenceSeparator};
   c.change();dialog.close();c.draw();document.querySelector('[data-bom-line]')?.focus();
  }catch(e){report(e);}
 });
 load.disabled=true;
 picker=materialSourcePicker({root:root.querySelector('[data-bom-source]'),call:(name,data,options)=>api('/api/research/materials/'+name,data,options),esc,field,label:m('originalBomFile'),id:'bom-source-select',recordId,kind:'artifact',guard});
 await picker.ready;if(!disposed)load.disabled=false;
}
