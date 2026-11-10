import {t} from './i18n/index.js';
import './i18n/catalogues/datasetProfile.js';
export const profileText=(key,params)=>t('datasetProfile',key,params);

export function schemaGroupControls(offset,columns,{esc,field}){
 const label=key=>esc(profileText(key));
 return '<details data-schema-group><summary>'+label('group')+'</summary><div class="material-fields">'+
  field(label('copyFrom'),'<select data-donor>'+columns.map((col,i)=>'<option value="'+(offset+i)+'">'+esc(String(offset+i+1)+' · '+col.name)+'</option>').join('')+'</select>')+
  field(label('targets'),'<input data-targets type="text" inputmode="text" aria-describedby="schema-group-range">')+
  '</div><p id="schema-group-range">'+label('rangeHelp')+'</p><fieldset><legend>'+label('properties')+'</legend><div class="inline-actions">'+
  ['number','quantity','missing','time'].map(name=>'<label><input type="checkbox" data-property="'+name+'"> '+label(name)+'</label>').join('')+
  '</div></fieldset><div class="inline-actions"><button type="button" class="button" data-group-review>'+label('review')+'</button>'+
  '<button type="button" class="button primary" data-group-accept disabled>'+label('applyDraft')+'</button><button type="button" class="button" data-group-cancel>'+label('cancelReview')+'</button></div>'+
  '<p role="status" data-group-status></p><div data-group-details></div></details>';
}

export function parseColumnRanges(raw,width){
 const ranges=[];
 for(const term of raw.split(',')){
  const match=/^\s*([1-9]\d*)\s*(?:[-–]\s*([1-9]\d*))?\s*$/u.exec(term);
  if(!match)return null;
  const start=Number(match[1]),end=Number(match[2]??match[1]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>width)return null;
  ranges.push({offset:start-1,count:end-start+1});
 }
 ranges.sort((a,b)=>a.offset-b.offset);
 const merged=[];
 for(const range of ranges){
  const prior=merged.at(-1);
  if(prior&&prior.offset+prior.count>=range.offset)prior.count=Math.max(prior.offset+prior.count,range.offset+range.count)-prior.offset;
  else merged.push(range);
 }
 return merged;
}

export function reviewLocations(items,{esc}){
 if(!items.length)return '';
 return '<table><thead><tr><th>'+esc(profileText('location'))+'</th><th>'+esc(profileText('column'))+'</th><th>'+esc(profileText('sourceValue'))+'</th></tr></thead><tbody>'+
  items.map(item=>{
   const origin=item.locator??{},line=origin.cellPointer??origin.pointer??(origin.line!==undefined?profileText('line',{line:origin.line}):'');
   const reason=item.reason?(item.reason==='unexpected-kind'||item.reason==='unexpected-token'||item.reason==='invalid-column'?profileText(item.reason):t('errors',item.reason)):'';
   return '<tr><td>'+esc(line)+'</td><td>'+esc(item.name??'')+'</td><td><code>'+esc(item.spelling??item.value?.spelling??'')+'</code>'+(reason?' <small>'+esc(reason)+'</small>':'')+'</td></tr>';
  }).join('')+'</tbody></table>';
}

export function wireSchemaGroup(form,{esc,call,recordId,ref,width,capture,donor,pending,apply}){
 const root=form.querySelector('[data-schema-group]'),review=root.querySelector('[data-group-review]'),accept=root.querySelector('[data-group-accept]');
 const status=root.querySelector('[data-group-status]'),details=root.querySelector('[data-group-details]');
 let generation=0,controller,saved;
 const reset=()=>{generation++;controller?.abort();saved=null;accept.disabled=true;review.disabled=false;status.textContent='';details.replaceChildren();};
 root.querySelector('[data-group-cancel]').onclick=()=>{reset();root.querySelector('[data-targets]').value='';for(const item of root.querySelectorAll('[data-property]'))item.checked=false;root.open=false;root.querySelector('summary').focus();};
 form.addEventListener('input',reset);form.addEventListener('change',reset);
 review.onclick=async()=>{
  reset();const current=generation;controller=new AbortController();review.disabled=true;
  try{
   await capture();if(!form.isConnected||current!==generation)return;
   const sourceIndex=Number(root.querySelector('[data-donor]').value),ranges=parseColumnRanges(root.querySelector('[data-targets]').value,width);
   const properties=[...root.querySelectorAll('[data-property]:checked')].map(el=>el.dataset.property);
   if(!ranges||!properties.length)throw Error(profileText('invalidSelection'));
   const command={ref,sourceIndex,sourceColumn:donor(sourceIndex),properties,ranges,pending:pending(ranges)};
   status.textContent=profileText('checking');
   const report=await call('dataset-schema-group-review',{recordId,command,offset:0,limit:32},{signal:controller.signal});
   if(!form.isConnected||current!==generation)return;
   status.textContent=profileText('reviewCount',{selected:report.selected,changed:report.changed,invalid:report.invalid});
   details.innerHTML=reviewLocations(report.issues.length?report.issues:report.examples,{esc});
   if(!report.invalid&&report.changed){saved={command,first:report.changedColumns};accept.disabled=false;}
  }catch(error){if(form.isConnected&&current===generation)status.textContent=error.message;}
  finally{if(form.isConnected&&current===generation)review.disabled=false;}
 };
 accept.onclick=async()=>{
  if(!saved||accept.disabled)return;
  const current=generation,{command,first}=saved;
  accept.disabled=true;review.disabled=true;
  try{
   const pages=[first.items];let next=first.next;
   while(next!==null){
    const report=await call('dataset-schema-group-columns',{recordId,command,offset:next,limit:64},{signal:controller.signal});
    if(!form.isConnected||current!==generation)return;
    pages.push(report.changedColumns.items);next=report.changedColumns.next;
   }
   await apply(pages);
  }catch(error){if(form.isConnected&&current===generation){status.textContent=error.message;accept.disabled=false;review.disabled=false;}}
 };
 return ()=>{generation++;controller?.abort();form.removeEventListener('input',reset);form.removeEventListener('change',reset);};
}
