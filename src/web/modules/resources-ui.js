import {bomSourcesUI} from './bom-sources-ui.js';
import {bomOperationUI} from './bom-operation-ui.js';
import {localBOMResource} from './bom-model.js';
import {resourceTagsUI} from './resource-tags-ui.js';
import {newBOM,bomForm,bomStock,bomReadonly,bomInput,bomAction,bomSubmit,stockPreview} from './bom-ui.js';
import {moduleSchemaFields} from './schema-fields.js';
import {inventoryClient} from './inventory-client.js';
import {t} from '../i18n/index.js';
import {proseText} from '../prose-model.js';
import {moduleEditor} from './workbench.js';
import {stockTracked,inventoryItems,inventoryOwner,inventoryLocation,assetPlacement} from './inventory-model.js';
import {inventoryScopeControl,inventoryCardFacts,inventoryPlaces,inventoryStockSection,inventoryStockAction,inventoryStockSubmit} from './inventory-stock-ui.js';
const statuses=[['available','Available'],['hold','On hold'],['retired','Retired']];
const tr=(key,args)=>t('inventoryData',key,args);
export function createResourcesUI(services){let context;const tags=resourceTagsUI();
 const category=async id=>{const reply=await services.api('/api/modules/item',{workspaceId:services.state.book.id,id});if(reply.workspaceId!==services.state.book.id||reply.entity?.id!==id||reply.entity.type!=='category'||!Array.isArray(reply.entity.data.fields))throw Error(tr('invalid'));return reply.entity;};
 const applyCategory=(draft,value)=>{draft.data.categoryId=value?.id??null;draft.data.schemaRevision=value?.revision??null;draft.data.fieldSchema=structuredClone(value?.data.fields??[]);draft.data.values=Object.fromEntries(draft.data.fieldSchema.filter(f=>Object.hasOwn(draft.data.values,f.key)).map(f=>[f.key,draft.data.values[f.key]]));};
 return moduleEditor(services,{
 listQuery:tags.query,listTools:tags.filters,listInput:tags.filterInput,
 id:'resources',initialType:'resource',scoped:true,paged:true,label:'Inventory',readOnly:d=>bomReadonly(d)||d.type==='bom'&&!!context?.bomOperations?.summary()&&!context.bomOperations.summary().terminal,
 setup(c){context=c;c.schema=moduleSchemaFields(c);c.inventory=inventoryClient(c,{card:inventoryCardFacts,stock:inventoryStockSection,bom:stockPreview});if(services.state.storage?.researchStorage==='catalogue'&&services.state.storage.researchFormatVersion===21){c.bomSources=bomSourcesUI(services,c);c.bomOperations=bomOperationUI(services,c);}},
 bind:c=>{c.inventory.bind();c.bomSources?.bind();c.bomOperations?.bind();},deactivate:c=>{c.inventory.stop();c.bomSources?.stop();c.bomOperations?.stop();},dispose:c=>{c.inventory.stop();c.bomSources?.stop();c.bomOperations?.stop();},afterCommand:c=>{c.inventory.invalidate();c.bomSources?.invalidate();c.bomOperations?.settled();},
 commandRequest:(run,command)=>context.bomOperations?context.bomOperations.commandRequest(run,command):run(),
 pendingCommand:(result,command)=>context.bomOperations.pendingCommand(result,command),
 itemFields:d=>d?.type==='resource'?[{key:'categoryId',type:'category',query:{archived:false},select:async item=>{const value=await category(item.id);return ()=>applyCategory(d,value);}}]:d?.type==='bom'?d.data.lines.filter(line=>!line.resourceId||localBOMResource(line,services.state.book.id)).map(line=>({key:'bom-'+line.id,type:'resource',query:{kind:'material'},get:()=>localBOMResource(line,services.state.book.id),select:async item=>{const value=await context.inventory.selected(item.id);return ()=>{line.resourceId=item.id;line.unit=value.data.unit;if(!line.value)line.value=value.data.name;};}})):[],
 summaryCard:(e,c)=>`<h2>${c.esc(e.title)}</h2>${tags.summary(e.tags,c)}${e.description?`<p>${c.esc(e.description)}</p>`:''}${e.type==='resource'?`<div data-inventory-card="${e.id}">${c.inventory.get(e.id)?inventoryCardFacts(c.inventory.get(e.id),c):c.inventory.message()}</div>`:''}`,
 operationConflictMessage:'This item changed while you were preparing the transaction. Nothing was transferred or consumed. Cancel this transaction, review the latest stock, then try again.',
 availableItems:entities=>entities,entityAvailable:()=>true,scopeItems:inventoryItems,scopeControl:c=>c.current?.type==='bom'?'':inventoryScopeControl(c),
 showTabs:c=>c.current?.type!=='bom',backLabel:d=>d.type==='bom'?'All BOMs':null,
 ownerLabel:(e,c)=>'Owned by '+inventoryOwner(c.services.state.book,e.data.projectId),
 listTitle:(type,c)=>type.id==='resource'?(c.scopeId?inventoryOwner(c.services.state.book,c.scopeId):c.services.state.book.title)+' inventory':type.label,
 saveCommand(d){
  if(d.type!=='resource')return;
  const {openingQuantity,openingProjectId,...data}=d.data;
  return d.expectedRevision===null?{action:'resource.create',payload:{id:d.id,data,openingStock:{quantity:stockTracked(data)?openingQuantity:'0',projectId:openingProjectId||null}}}:{action:'resource.save',payload:{id:d.id,expectedRevision:d.expectedRevision,data}};
 },
 savedSection:(d,creating)=>creating&&d.type==='resource'?'stock':null,
 beforeSave:(d,c)=>{if(d.type==='category'||d.type==='resource')c.schema.validate({edit:d.type==='category'});},
 recoverOperation(d){
  const op=d.operation;
  if(!Number.isSafeInteger(op?.values?.expectedRevision))return false;
  if(d.type==='bom')return op.kind==='bom-finish'&&Array.isArray(op.values.usage)&&op.values.usage.every(u=>d.data.lines.some(l=>l.id===u.lineId)&&typeof u.used==='string'&&typeof u.scrapped==='string');
  return d.type==='resource'&&['receive','consume','adjust','reserve','transfer','assign'].includes(op.kind);
 },
 operationInput(el,c){if(['projectId','fromProjectId','toProjectId'].includes(el.dataset.operationField)){const key=el.dataset.operationField;c.draw();document.querySelector('[data-operation-field="'+key+'"]')?.focus({preventScroll:true});}},

 types:[{id:'bom',label:'Bills of materials',singular:'BOM',statuses:[['draft','Draft'],['reserved','Reserved'],['finished','Finished'],['cancelled','Cancelled']],empty:'Plan components for a prototype or run, reserve stock, then record actual use.'},{id:'resource',label:'Items',singular:'item',statuses,empty:'Add owned equipment, materials, instruments or software. Receive stock centrally and allocate it to projects.'},{id:'category',label:'Categories',singular:'category',empty:'Define the fields your work needs. Existing resources retain the field version they were created with.'}],
 blank:(type,c)=>type==='bom'?newBOM():type==='category'?{name:'',description:'',fields:[],archived:false}:{projectId:null,placementId:c.creationScopeId,openingQuantity:'0',openingProjectId:c.creationScopeId,name:'',code:'',kind:'object',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'',capacity:1,status:'available',links:[],tags:[]},
 card(e,c){const d=e.data;if(e.type==='bom')return '<h2>'+c.esc(d.title)+'</h2><p>'+c.esc(d.recordTitle+' / '+d.status+' / '+d.buildCount+' builds')+'</p>'+c.links(d.links);return `<div class="module-item-heading"><h2>${c.esc(d.name)}</h2><span class="status-badge">${c.esc(e.type==='category'?(d.archived?'Archived':'Category'):{object:'Individual item',equipment:'Equipment',material:'Material / consumable',software:'Software / licences'}[d.kind])}</span></div><p>${c.esc(proseText(d.description))}</p>${e.type==='resource'?`<p class="muted">${c.esc([d.code,d.location,statuses.find(s=>s[0]===d.status)?.[1]].filter(Boolean).join(' · '))}</p>${tags.summary(d.tags,c)}${inventoryCardFacts(e,c)}${c.links(d.links)}`:`<p>${d.fields.length} custom fields</p>`}`;},
 form(d,c){
  const {input,area,select,check,field,option,esc,button}=c,v=d.data;
  if(d.type==='bom')return bomForm(d,c);
  if(d.type==='category')return `<section class="module-block"><h2>Category</h2>${input('name','Category name','text','required maxlength="160"')}${area('description','Description')}${check('archived','Archive category (existing resources are retained)')}</section><section class="module-block">${c.schema.view({edit:true})}</section>`;
  return `<section class="module-block"><h2>Item details</h2>${c.ownerField('Owned by')}<div class="form-grid">${input('name','Item name','text','required maxlength="240"')}${input('code','Unique code / identifier')}${select('kind','Item kind',[['object','General item'],['material','Material / consumable stock'],['equipment','Equipment / bookable resource'],['software','Software / licences']])}${select('status','Availability',statuses)}${input('location','Storage place')}${stockTracked(v)?input('unit','Stock unit','text','required placeholder="e.g. mL, g, items"'):v.kind==='equipment'?input('capacity','Simultaneous places','number','required min="1" step="1"'):''}</div>${d.expectedRevision===null?(stockTracked(v)?`<div class="form-grid">${input('openingQuantity','Opening quantity','text','required inputmode="decimal"')}${select('openingProjectId','Initially held at',inventoryPlaces(c).map(([id,label])=>[id??'',label]))}</div>`:select('placementId','Held at',inventoryPlaces(c).map(([id,label])=>[id??'',label]))):stockTracked(v)?'<p class="muted">Use Stock & allocations to receive, transfer or consume stock.</p>':`<p>Held at ${esc(inventoryLocation(c.services.state.book,assetPlacement(c.get(d.id))))}. Use Placement to move this item.</p>`}${area('description','Description and notes')}${tags.field(d,c)}</section><section class="module-block"><h2>Category & fields</h2>${c.itemField('categoryId',tr('chooseCategory'))}${v.categoryId?`<p>${esc(tr('categoryRevision',{revision:v.schemaRevision}))}</p>${button('Apply current category fields','upgrade-schema')}${button(tr('clearCategory'),'clear-category')}`:''}${c.schema.view()}</section>${c.referenceFields()}`;
 },
 sections:d=>d.type==='bom'?[['stock','Build & stock']]:d.type==='resource'?[['stock',stockTracked(d.data)?'Stock & allocations':'Placement'],['connections','Connections']]:[],
 section(name,c){
  if(c.current.type==='bom')return bomStock(c);
  if(name==='stock')return `<div data-inventory-stock>${c.inventory.loading||c.inventory.error?c.inventory.message():inventoryStockSection(c)}</div>`;
  return '<section class="module-block"><h2>Connected work</h2><div data-inventory-links>'+c.inventory.connectionView()+'</div></section>';
 },
 input(el,c){
  if(c.current?.type==='bom')return bomInput(el,c);
  const d=c.current?.data;if(!d)return false;
  if(el.dataset.moduleField==='kind'){if(d.kind==='software'&&!d.unit)d.unit='licences';c.draw();return true;}
  if(['placementId','openingProjectId'].includes(el.dataset.moduleField)){d[el.dataset.moduleField]=el.value||null;return true;}
  if(tags.input(el,c))return true;
  if(c.schema.input(el))return true;
  return false;
 },
 async action(name,node,c){
  if(await c.bomSources?.action(name,node)||await c.bomOperations?.action(name,node))return;
  if(await bomAction(name,node,c))return;
  if(c.schema.action(name,node))return;
  const d=c.current,a=node.dataset;
  if(await c.inventory.action(name,node))return;
  if(name==='clear-category'){applyCategory(d,null);c.change();c.draw();}
  if(name==='upgrade-schema'){const value=await category(d.data.categoryId);if(c.current!==d)return;applyCategory(d,value);c.change();c.draw();}
  await inventoryStockAction(name,node,c);
 },
 submit:async(form,c)=>{const result=await bomSubmit(form,c);return result||await inventoryStockSubmit(form,c);}

});}
