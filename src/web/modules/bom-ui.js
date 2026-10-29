import '../i18n/catalogues/moduleReferences.js';
import '../i18n/catalogues/inventoryData.js';
import {projectApiRoute,researchOwner} from '../project-context.js';
import {t} from '../i18n/index.js';
import {openBOMImport} from './bom-import-ui.js';
import {blankBOM,bomLine,requiredQuantity,bomAvailability,bomRequirements,bomResourceReference,bomResourceKey,localBOMResource} from './bom-model.js';
import {add,negate,compare} from './quantities.js';
import {m,inventoryLocation,statusLabel} from './editor-presentation.js';
export const newBOM=()=>blankBOM();
export const bomReadonly=d=>d.type==='bom'&&d.data.status!=='draft';
const safeQuantity=(bom,line)=>{try{return requiredQuantity(bom,line);}catch{return '?';}};
export function stockPreview(d,c){
 if(c.bomSources?.handles(d))return c.bomSources.preview(d);
 if(c.inventory&&(c.inventory.loading||c.inventory.error))return c.inventory.message();
 const {esc}=c;
 try{const rows=c.inventory?bomRequirements(d).map(group=>{const item=c.inventory.get(group.resourceId),available=item?.locations.find(r=>r.projectId===group.projectId)?.available??'0';return {...group,item,available,shortage:compare(group.quantity,available)>0?add(group.quantity,negate(available)):'0'};}):bomAvailability(d,c.all());return '<ul>'+rows.map(row=>'<li>'+c.esc(m('requirement',{item:row.item?.data.name??m('unavailableItem'),location:inventoryLocation(c.services.state.book,row.projectId),quantity:row.quantity,available:row.available})+(row.shortage!=='0'?m('shortage',{quantity:row.shortage}):''))+'</li>').join('')+'</ul>';}
 catch{return '<p>'+esc(m('validQuantities'))+'</p>';}
}
export function bomForm(d,c){
 const v=d.data,{esc,field,input,button}=c,book=c.services.state.book,locked=bomReadonly(d)||!!c.bomOperations?.summary()&&!c.bomOperations.summary().terminal;
 const places=[[null,inventoryLocation(book,null)],...book.projects.map(p=>[p.id,p.title])];
 const attrs=(line,key)=>' data-bom-line="'+line.id+'" data-bom-field="'+key+'"';
 const partInput=(line,key,label)=>field(esc(label),'<input'+attrs(line,key)+' value="'+esc(line[key])+'" '+(['value','quantity','unit'].includes(key)?'required':'')+'>');
 const lines=v.lines.map((line,i)=>'<fieldset class="bom-line"><legend>'+esc(m('componentNumber',{number:i+1}))+'</legend><div class="form-grid">'+
  partInput(line,'references',m('referencesComma'))+partInput(line,'value',m('valueDescription'))+
  partInput(line,'quantity',m('quantityPerBuild'))+partInput(line,'unit',m('unit'))+
  (c.bomSources?c.bomSources.field(line):c.itemField('bom-'+line.id,t('inventoryData','chooseComponent')))+(line.resourceId?button(t('inventoryData','unlinkComponent'),'bom-unlink','data-id="'+line.id+'"'):'')+
  (c.bomSources?.placementField(line)??field(esc(m('takeStock')),'<select'+attrs(line,'sourceProjectId')+'>'+places.map(([id,label])=>c.option(id??'',label,line.sourceProjectId??'')).join('')+'</select>'))+
  '</div><label class="checkbox"><input type="checkbox"'+attrs(line,'dnp')+' '+(line.dnp?'checked':'')+'>'+esc(m('dnp'))+'</label>'+
  '<p data-bom-total="'+line.id+'">'+esc(m('totalNeeded',{quantity:safeQuantity(v,line),unit:line.unit}))+'</p>'+
  '<details '+c.disclosure('bom-'+line.id)+'><summary>'+esc(m('partIdentification'))+'</summary><div class="form-grid">'+partInput(line,'footprint',m('footprintPackage'))+partInput(line,'partNumber',m('manufacturerPart'))+'</div>'+partInput(line,'notes',m('supplierNotes'))+'</details>'+
  button(m('removeComponent'),'bom-remove','data-id="'+line.id+'"')+'</fieldset>').join('');
 return '<section class="module-block"><h2>'+esc(m('billMaterials'))+'</h2><p>'+esc(m('bomPlanHelp'))+'</p>'+
  (v.recordRevision?'<p>'+esc(m('bomLinked',{record:v.recordTitle,revision:v.recordRevision.slice(0,12)}))+'</p>'+c.links(v.links):'')+
  '<fieldset data-bom-plan '+(locked?'disabled':'')+'><legend>'+esc(m('buildPlan'))+'</legend>'+input('title',m('bomTitle'),'text','required maxlength="240"')+
  c.recordField('recordId',t('moduleReferences','prototype'))+
  '<div class="form-grid">'+input('designRevision',m('designRevision'),'text','maxlength="240"')+input('buildCount',m('buildCount'),'text','required inputmode="numeric" pattern="[1-9][0-9]{0,5}"')+'</div>'+
  field(esc(m('bomNotes')),'<textarea data-module-field="notes" maxlength="10000">'+esc(v.notes)+'</textarea>')+
  '<p>'+esc(m('componentChoiceHelp'))+'</p>'+
  (v.source?'<details><summary>'+esc(m('originalBom'))+'</summary><p>'+esc(m('fileBytes',{name:v.source.name,size:v.source.size}))+'</p><p>SHA-256: <code>'+esc(v.source.sha256)+'</code></p><p>'+esc(m('mappingRetained'))+'</p><a class="button" download href="'+projectApiRoute('/api/research/materials/original/'+v.source.artifact.id+'/'+v.source.artifact.revision,researchOwner(c.services.state))+'?context='+encodeURIComponent(c.services.state.storage.contextId)+'">'+esc(m('downloadBom'))+'</a></details>':'')+
  (!locked&&!v.lines.length&&!v.source?button(m('importRetainedBom'),'bom-import'):'')+
  '<div data-bom-lines>'+lines+'</div>'+button(m('addComponent'),'bom-add',v.lines.length>=200?'disabled':'')+
  '<p class="muted">'+esc(m('bomLineLimit'))+'</p></fieldset>'+
  (v.status==='draft'?'<section aria-label="'+esc(m('stockRequirements'))+'"><h3>'+esc(m('stockRequirements'))+'</h3><div data-bom-preview>'+stockPreview(v,c)+'</div></section>':'<p>'+esc(m('buildFixed',{status:statusLabel(v.status)}))+'</p>')+
  (d.expectedRevision!==null?button(m('copyBuild'),'bom-copy'):'')+'</section>';
}
export function bomStock(c){
 const e=c.get(c.current.id),v=c.operation?.kind==='bom-finish'&&c.current.expectedRevision!==null?c.current.base:e?.data,{esc,field,button}=c;
 if(!v)return '<p>'+esc(m('saveBomFirst'))+'</p>';
 const operation=c.bomOperations?.view()??'';
 if(c.operation?.kind==='bom-finish'){
  const usage=c.operation.values.usage;
  return operation+'<div data-bom-stock-actions><form data-module-form data-operation="bom-finish" class="module-block"><h2>'+esc(m('recordComponentUse'))+'</h2><p>'+esc(m('actualUseHelp'))+'</p>'+
   usage.map(u=>{const line=v.lines.find(l=>l.id===u.lineId);return '<fieldset><legend>'+esc(m('quantityReserved',{name:line.references||line.value,quantity:requiredQuantity(v,line),unit:line.unit}))+'</legend><div class="form-grid">'+
    ['used','scrapped'].map(key=>field(esc(key==='used'?m('actuallyUsed'):m('scrapped')),'<input required inputmode="decimal" data-bom-usage="'+u.lineId+'" data-bom-field="'+key+'" value="'+esc(u[key])+'">')).join('')+'</div></fieldset>';}).join('')+
   '<div class="module-actions">'+button(m('cancel'),'cancel-operation')+'<button class="button primary" type="submit">'+esc(m('recordRelease'))+'</button></div></form></div>';
 }
 const summary=v.status==='finished'?'<h3>'+esc(m('actualComponentUse'))+'</h3>'+v.usage.map(u=>{const line=v.lines.find(l=>l.id===u.lineId);return '<p>'+esc(m('usageSummary',{name:line.references||line.value,used:u.used,scrapped:u.scrapped,unused:add(requiredQuantity(v,line),negate(add(u.used,u.scrapped))),unit:line.unit}))+'</p>';}).join(''):'';
 return operation+'<section class="module-block" data-bom-stock-actions><h2>'+esc(m('buildStock'))+'</h2><p>'+esc(m('statusValue',{status:statusLabel(v.status)}))+'</p>'+
  (v.status==='draft'?'<div data-bom-preview>'+stockPreview(v,c)+'</div><p>'+esc(m('reserveHelp'))+'</p>'+button(m('reserveComponents'),'bom-reserve',c.inventory&&(c.inventory.loading||c.inventory.error)?'disabled':''):
   v.status==='reserved'?'<p>'+esc(m('reservedHelp'))+'</p>'+button(m('recordActualUse'),'bom-finish')+button(m('cancelBuild'),'bom-cancel'):
   v.status==='cancelled'?'<p>'+esc(m('allReleased'))+'</p>':summary)+'</section>';
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
  for(const line of data.lines){const total=document.querySelector('[data-bom-total="'+line.id+'"]');if(total)total.textContent=m('totalNeeded',{quantity:safeQuantity(data,line),unit:line.unit});}
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
 if(d.expectedRevision===null||JSON.stringify(v)!==JSON.stringify(d.base))throw new Error(m('saveBomEdits'));
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
