import {projectApiRoute,researchOwner} from '../project-context.js';
import {t} from '../i18n/index.js';
import {openBOMImport} from './bom-import-ui.js';
import {blankBOM,bomLine,requiredQuantity,bomAvailability,bomRequirements,bomResourceReference,bomResourceKey,localBOMResource} from './bom-model.js';
import {add,negate,compare} from './quantities.js';
import {inventoryLocation} from './inventory-model.js';
export const newBOM=()=>blankBOM();
export const bomReadonly=d=>d.type==='bom'&&d.data.status!=='draft';
const safeQuantity=(bom,line)=>{try{return requiredQuantity(bom,line);}catch{return '?';}};
export function stockPreview(d,c){
 if(c.bomSources?.handles(d))return c.bomSources.preview(d);
 if(c.inventory&&(c.inventory.loading||c.inventory.error))return c.inventory.message();
 try{const rows=c.inventory?bomRequirements(d).map(group=>{const item=c.inventory.get(group.resourceId),available=item?.locations.find(r=>r.projectId===group.projectId)?.available??'0';return {...group,item,available,shortage:compare(group.quantity,available)>0?add(group.quantity,negate(available)):'0'};}):bomAvailability(d,c.all());return '<ul>'+rows.map(row=>'<li>'+c.esc((row.item?.data.name??'Unavailable item')+' / '+inventoryLocation(c.services.state.book,row.projectId)+': need '+row.quantity+', available '+row.available+(row.shortage!=='0'?', short '+row.shortage:''))+'</li>').join('')+'</ul>';}
 catch{return '<p>Enter valid quantities to calculate stock requirements.</p>';}
}
export function bomForm(d,c){
 const v=d.data,{esc,field,input,button}=c,book=c.services.state.book,locked=bomReadonly(d)||!!c.bomOperations?.summary()&&!c.bomOperations.summary().terminal;
 const places=[[null,inventoryLocation(book,null)],...book.projects.map(p=>[p.id,p.title])];
 const attrs=(line,key)=>' data-bom-line="'+line.id+'" data-bom-field="'+key+'"';
 const partInput=(line,key,label)=>field(label,'<input'+attrs(line,key)+' value="'+esc(line[key])+'" '+(['value','quantity','unit'].includes(key)?'required':'')+'>');
 const lines=v.lines.map((line,i)=>'<fieldset class="bom-line"><legend>Component '+(i+1)+'</legend><div class="form-grid">'+
  partInput(line,'references','References (comma-separated)')+partInput(line,'value','Value / description')+
  partInput(line,'quantity','Quantity per build')+partInput(line,'unit','Unit')+
  (c.bomSources?c.bomSources.field(line):c.itemField('bom-'+line.id,t('inventoryData','chooseComponent')))+(line.resourceId?button(t('inventoryData','unlinkComponent'),'bom-unlink','data-id="'+line.id+'"'):'')+
  (c.bomSources?.placementField(line)??field('Take stock from','<select'+attrs(line,'sourceProjectId')+'>'+places.map(([id,label])=>c.option(id??'',label,line.sourceProjectId??'')).join('')+'</select>'))+
  '</div><label class="checkbox"><input type="checkbox"'+attrs(line,'dnp')+' '+(line.dnp?'checked':'')+'>Do not populate (DNP)</label>'+
  '<p data-bom-total="'+line.id+'">Total needed: '+esc(safeQuantity(v,line)+' '+line.unit)+'</p>'+
  '<details '+c.disclosure('bom-'+line.id)+'><summary>Part identification & substitution notes</summary><div class="form-grid">'+partInput(line,'footprint','Footprint / package')+partInput(line,'partNumber','Manufacturer part number')+'</div>'+partInput(line,'notes','Supplier / lot / substitutions and reason')+'</details>'+
  button('Remove component','bom-remove','data-id="'+line.id+'"')+'</fieldset>').join('');
 return '<section class="module-block"><h2>Bill of materials</h2><p>A component plan for one build or run. Saving a plan does not use stock.</p>'+
  (v.recordRevision?'<p>Linked to '+esc(v.recordTitle)+' at saved revision <code>'+esc(v.recordRevision.slice(0,12))+'</code>.</p>'+c.links(v.links):'')+
  '<fieldset data-bom-plan '+(locked?'disabled':'')+'><legend>Build plan</legend>'+input('title','BOM title','text','required maxlength="240"')+
  c.recordField('recordId',t('moduleReferences','prototype'))+
  '<div class="form-grid">'+input('designRevision','Design revision / assembly variant','text','maxlength="240"')+input('buildCount','Number of builds','text','required inputmode="numeric" pattern="[1-9][0-9]{0,5}"')+'</div>'+
  field('BOM notes','<textarea data-module-field="notes" maxlength="10000">'+esc(v.notes)+'</textarea>')+
  '<p>Choose the exact inventory item and stock source for each populated line. Component values stay as written, such as 4k7 or 100 nF; no equivalence or substitution is assumed.</p>'+
  (v.source?'<details><summary>Original BOM source</summary><p>'+esc(v.source.name)+' / '+v.source.size+' bytes</p><p>SHA-256: <code>'+esc(v.source.sha256)+'</code></p><p>The reviewed column mapping is retained. This plan may include later manual edits.</p><a class="button" download href="'+projectApiRoute('/api/research/materials/original/'+v.source.artifact.id+'/'+v.source.artifact.revision,researchOwner(c.services.state))+'?context='+encodeURIComponent(c.services.state.storage.contextId)+'">Download original BOM</a></details>':'')+
  (!locked&&!v.lines.length&&!v.source?button('Import retained BOM table','bom-import'):'')+
  '<div data-bom-lines>'+lines+'</div>'+button('Add component','bom-add',v.lines.length>=200?'disabled':'')+
  '<p class="muted">Up to 200 lines per BOM. Keep source BOMs and fabrication files in the linked record\'s Evidence & analysis.</p></fieldset>'+
  (v.status==='draft'?'<section aria-label="Stock requirements"><h3>Stock requirements</h3><div data-bom-preview>'+stockPreview(v,c)+'</div></section>':'<p>Build status: <strong>'+esc(v.status)+'</strong>. This plan is fixed; use a copy for another revision or run.</p>')+
  (d.expectedRevision!==null?button('Duplicate for another build','bom-copy'):'')+'</section>';
}
export function bomStock(c){
 const e=c.get(c.current.id),v=c.operation?.kind==='bom-finish'&&c.current.expectedRevision!==null?c.current.base:e?.data,{esc,field,button}=c;
 if(!v)return '<p>Save the BOM before reserving components.</p>';
 const operation=c.bomOperations?.view()??'';
 if(c.operation?.kind==='bom-finish'){
  const usage=c.operation.values.usage;
  return operation+'<div data-bom-stock-actions><form data-module-form data-operation="bom-finish" class="module-block"><h2>Record actual component use</h2><p>Enter what was actually fitted or used and what was scrapped. Remaining reserved parts return to availability at their original source. This does not mark the experiment successful.</p>'+
   usage.map(u=>{const line=v.lines.find(l=>l.id===u.lineId);return '<fieldset><legend>'+esc(line.references||line.value)+' / '+esc(requiredQuantity(v,line)+' '+line.unit)+' reserved</legend><div class="form-grid">'+
    ['used','scrapped'].map(key=>field(key==='used'?'Actually used':'Scrapped','<input required inputmode="decimal" data-bom-usage="'+u.lineId+'" data-bom-field="'+key+'" value="'+esc(u[key])+'">')).join('')+'</div></fieldset>';}).join('')+
   '<div class="module-actions">'+button('Cancel','cancel-operation')+'<button class="button primary" type="submit">Record use and release unused</button></div></form></div>';
 }
 const summary=v.status==='finished'?'<h3>Actual component use</h3>'+v.usage.map(u=>{const line=v.lines.find(l=>l.id===u.lineId);return '<p>'+esc((line.references||line.value)+': '+u.used+' used, '+u.scrapped+' scrapped, '+add(requiredQuantity(v,line),negate(add(u.used,u.scrapped)))+' unused / '+line.unit)+'</p>';}).join(''):'';
 return operation+'<section class="module-block" data-bom-stock-actions><h2>Build & stock</h2><p>Status: <strong>'+esc(v.status)+'</strong></p>'+
  (v.status==='draft'?'<div data-bom-preview>'+stockPreview(v,c)+'</div><p>Reserve only after reviewing item choices, sources and quantities. All lines are reserved together.</p>'+button('Reserve components','bom-reserve',c.inventory&&(c.inventory.loading||c.inventory.error)?'disabled':''):
   v.status==='reserved'?'<p>Components are reserved. Record actual use when finished, or cancel the build to release all parts.</p>'+button('Record actual use','bom-finish')+button('Cancel build and release stock','bom-cancel'):
   v.status==='cancelled'?'<p>All reservations were released. No components were consumed.</p>':summary)+'</section>';
}
export function bomInput(el,c){
 if(c.current?.type!=='bom')return false;
 const data=c.current.data;
 if(el.dataset.bomUsage&&c.operation?.kind==='bom-finish'){
  const usage=c.operation.values.usage.find(u=>u.lineId===el.dataset.bomUsage);if(usage&&['used','scrapped'].includes(el.dataset.bomField))usage[el.dataset.bomField]=el.value;return true;
 }
 if(data.status!=='draft')return false;
 if(el.dataset.bomLine){
  const line=data.lines.find(l=>l.id===el.dataset.bomLine),key=el.dataset.bomField;if(!line)return false;
  line[key]=key==='dnp'?el.checked:['resourceId','sourceProjectId'].includes(key)?el.value||null:el.value;
  if(key==='resourceId'&&line.resourceId){const resource=c.get(line.resourceId);line.unit=resource.data.unit;if(!line.value)line.value=resource.data.name;c.draw();document.querySelector('[data-bom-line="'+line.id+'"][data-bom-field="resourceId"]')?.focus({preventScroll:true});}
 }
 if(el.dataset.bomLine||['buildCount','recordId'].includes(el.dataset.moduleField)){
  const preview=document.querySelector('[data-bom-preview]');if(preview){if(c.bomSources?.handles(data))c.bomSources.paint();else preview.innerHTML=stockPreview(data,c);}
  c.bomSources?.changed();
  for(const line of data.lines){const total=document.querySelector('[data-bom-total="'+line.id+'"]');if(total)total.textContent='Total needed: '+safeQuantity(data,line)+' '+line.unit;}
  return true;
 }
 return false;
}
export async function bomAction(name,node,c){
 if(!name.startsWith('bom-'))return false;
 const d=c.current,v=d.data;
 if(name==='bom-import'){await openBOMImport(c);return true;}
 if(name==='bom-copy'){const copy=structuredClone(v);delete copy.externalStock;await c.edit(crypto.randomUUID(),'bom',{...copy,title:v.title+' / next build',recordRevision:null,status:'draft',allocations:[],usage:[]});return true;}
 if(name==='bom-add'&&v.status==='draft'&&v.lines.length<200){const line=bomLine();v.lines.push(line);c.change();c.draw();document.querySelector('[data-bom-line="'+line.id+'"][data-bom-field="references"]')?.focus();return true;}
 if(name==='bom-remove'&&v.status==='draft'){v.lines=v.lines.filter(l=>l.id!==node.dataset.id);c.change();c.draw();return true;}
 if(name==='bom-unlink'&&v.status==='draft'){const line=v.lines.find(l=>l.id===node.dataset.id);if(line)line.resourceId=null;c.change();c.draw();return true;}
 if(d.expectedRevision===null||JSON.stringify(v)!==JSON.stringify(d.base))throw new Error('Save or discard BOM edits before changing stock.');
 const payload={id:d.id,expectedRevision:d.expectedRevision};
 if(name==='bom-finish'){c.openOperation('bom-finish',{expectedRevision:d.expectedRevision,usage:v.lines.filter(l=>!l.dnp).map(l=>({lineId:l.id,used:'',scrapped:'0'}))});return true;}
 if(name==='bom-reserve'){
  const ids=[...new Map(v.lines.filter(l=>!l.dnp&&l.resourceId).map(l=>[bomResourceKey(bomResourceReference(l,c.services.state.book.id)),l.resourceId])).values()];
  if(c.inventory&&(c.inventory.loading||c.inventory.error))return true;
  payload.resources=c.bomSources?.handles(v)?await c.bomSources.review():ids.map(id=>({id,revision:(c.inventory?c.inventory.get(typeof id==='string'?id:id.id):c.get(typeof id==='string'?id:id.id))?.revision??null}));
  await c.command('bom.reserve',payload);
 }
 if(name==='bom-cancel')await c.command('bom.cancel',payload);
 c.draw();return true;
}
export async function bomSubmit(form,c){
 if(form.dataset.operation!=='bom-finish')return false;
 const result=await c.command('bom.finish',{id:c.current.id,expectedRevision:c.operation.values.expectedRevision,usage:c.operation.values.usage});return Object.hasOwn(result,'operationPending')?result:true;
}
