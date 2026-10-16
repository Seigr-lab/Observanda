import {materialSourcePicker} from '../material-source-picker.js';
import {TABLE_DELIMITERS} from '../tabular-data.js';
import {BOM_COLUMNS,suggestedBOMMapping,mapBOMTable} from './bom-import-model.js';
import {bomLine} from './bom-model.js';

// Import is a separate review dialog. The BOM stays untouched until confirmation.
export async function openBOMImport(c){
 const {state,api,esc,field,showDialog}=c.services,draft=c.current,context=state.storage.contextId,recordId=draft.data.recordId;
 if(!recordId)throw Error('Choose the prototype / run record first. Import its original CSV or TSV in Evidence & analysis.');
 if(draft.data.status!=='draft'||draft.data.lines.length||draft.data.source)throw Error('Import into an empty draft BOM.');
 let loaded=null,preview=null,picker=null,request=null,disposed=false;
 const guard=()=>{if(disposed||state.storage.contextId!==context||c.current!==draft||draft.data.recordId!==recordId||draft.data.status!=='draft'||draft.data.lines.length||draft.data.source)throw Error('The BOM or workspace changed. Reopen import.');};
 showDialog('<div class="bom-import"><h2 id="dialog-title">Import bill of materials</h2><form id="bom-import-form">'+
  '<p>Choose an original CSV or TSV retained in the record\'s Evidence & analysis. Review columns before adding components. The original bytes stay unchanged.</p>'+
  '<div data-bom-source><input type="hidden" name="bom-source" data-value value=""></div>'+
  field('Column separator','<select name="bom-delimiter" data-bom-delimiter>'+TABLE_DELIMITERS.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('')+'</select>')+
  '<button type="button" class="button" data-bom-load>Read columns</button><p role="status" data-bom-message></p><div data-bom-mapping></div><div data-bom-review></div>'+
  '</form><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="button" class="button primary" data-bom-apply disabled>Add reviewed components</button></div></div>');
 const dialog=document.getElementById('dialog'),root=dialog.querySelector('.bom-import'),load=root.querySelector('[data-bom-load]'),apply=root.querySelector('[data-bom-apply]'),message=root.querySelector('[data-bom-message]'),mappingRoot=root.querySelector('[data-bom-mapping]'),review=root.querySelector('[data-bom-review]');
 const abort=()=>{disposed=true;picker?.dispose();request?.abort();};
 dialog.addEventListener('close',abort,{once:true});
 const report=e=>{if(!disposed&&e.name!=='AbortError')message.textContent=[e.message,...(e.details??[]).map(d=>d.field)].filter(Boolean).join(' ');};
 const invalidate=()=>{preview=null;apply.disabled=true;review.innerHTML='';};
 const clear=()=>{request?.abort();loaded=null;mappingRoot.innerHTML='';invalidate();};
 root.querySelector('[data-bom-delimiter]').addEventListener('change',clear);
 root.querySelector('[data-bom-source]').addEventListener('input',clear);
 const select=(key,label,value,choices)=>field(label,'<select name="bom-map-'+key+'" data-bom-map="'+key+'">'+choices.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>');
 const mapping=()=>Object.fromEntries(BOM_COLUMNS.map(([key])=>{const value=root.querySelector('[data-bom-map="'+key+'"]').value;return [key,value===''?null:Number(value)];}));
 const separator=()=>root.querySelector('[data-bom-reference-separator]').value;
 const reviewMapping=()=>{
  try{
   guard();invalidate();
   if(!loaded)throw Error('Read columns first.');
   const mapped=mapBOMTable(loaded.table,mapping(),{referenceSeparator:separator()});
   preview={...mapped,mapping:mapping(),referenceSeparator:separator()};
   const fields=[['row','Source line'],['references','References'],['value','Value'],['quantity','Per build'],['unit','Unit'],['dnp','DNP'],['footprint','Footprint'],['partNumber','Part number']];
   review.innerHTML='<h3>Review components</h3><p>'+mapped.lines.length+' component rows; '+mapped.lines.filter(l=>l.dnp).length+' DNP; '+mapped.excluded.length+' excluded.</p>'+
    '<p>Inventory items and stock sources remain unassigned. Quantities use decimal notation; component values are kept as written. Reference ranges are expanded. New lines can be edited before saving.</p>'+
    (preview.mapping.dnp===null?'<p><strong>No DNP column mapped: all included rows will be populated.</strong></p>':'')+
    (preview.mapping.exclude===null?'<p>No exclusion column mapped: no source rows will be excluded.</p>':'')+
    (mapped.unmapped.length?'<p>Columns retained only in the original: '+esc(mapped.unmapped.join(', '))+'.</p>':'')+
    '<div class="bom-import-table" tabindex="0" role="region" aria-label="Imported components"><table><thead><tr>'+fields.map(([,label])=>'<th scope="col">'+label+'</th>').join('')+'</tr></thead><tbody>'+
    mapped.lines.map(line=>'<tr>'+fields.map(([key,label])=>'<td data-label="'+label+'">'+esc(key==='dnp'?(line.dnp?'Yes':'No'):line[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
    (mapped.excluded.length?'<details><summary>Excluded source rows</summary><ul>'+mapped.excluded.map(r=>'<li>'+esc('Line '+r.row+': '+r.references+' / '+r.value)+'</li>').join('')+'</ul></details>':'')+
    '<label class="checkbox"><input type="checkbox" name="bom-reviewed" data-bom-reviewed>I reviewed the column mapping, quantities, DNP and exclusions.</label>';
   review.querySelector('[data-bom-reviewed]').addEventListener('change',e=>{apply.disabled=!e.target.checked;});
   message.textContent='Original verified: '+loaded.name+' / '+loaded.size+' bytes. No stock changes.';
  }catch(e){report(e);}
 };
 load.addEventListener('click',async()=>{
  clear();load.disabled=true;request=new AbortController();const active=request;
  try{
   guard();const artifact=picker.values()[0];message.textContent='Reading and verifying original...';
   const result=await api('/api/modules/bom-source',{artifact,delimiter:root.querySelector('[data-bom-delimiter]').value},{signal:active.signal});
   guard();if(request!==active||active.signal.aborted)return;loaded=result;
   const suggested=suggestedBOMMapping(loaded.table),columns=loaded.table.columns.map(col=>[col.index,col.label]);
   mappingRoot.innerHTML='<h3>Map source columns</h3><div class="form-grid">'+BOM_COLUMNS.map(([key,label])=>select(key,label,suggested[key]??'',[['',key==='unit'?'Use items':key==='dnp'?'All rows populated':key==='exclude'?'Exclude no rows':'Not mapped'],...columns])).join('')+
    field('Separator between references','<select name="bom-reference-separator" data-bom-reference-separator><option value=",">Comma</option><option value=";">Semicolon</option><option value="space">Spaces</option></select>')+'</div>'+
    '<button type="button" class="button" data-bom-preview>Review mapped components</button>';
   mappingRoot.querySelectorAll('select').forEach(el=>el.addEventListener('change',invalidate));
   mappingRoot.querySelector('[data-bom-preview]').addEventListener('click',reviewMapping);
   message.textContent='Check the suggested mapping, then review every component row.';
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
 picker=materialSourcePicker({root:root.querySelector('[data-bom-source]'),call:(name,data,options)=>api('/api/research/materials/'+name,data,options),esc,field,label:'Original BOM file',id:'bom-source-select',recordId,kind:'artifact',guard});
 await picker.ready;if(!disposed)load.disabled=false;
}
