import {m,statusLabel,inventoryLocation} from './editor-presentation.js';
import '../i18n/catalogues/inventoryData.js';
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
import {stockTracked,inventoryItems,inventoryOwner,assetPlacement} from './inventory-model.js';
import {inventoryScopeControl,inventoryCardFacts,inventoryPlaces,inventoryStockSection,inventoryStockAction,inventoryStockSubmit} from './inventory-stock-ui.js';
const statuses=()=>['available','hold','retired'].map(id=>[id,statusLabel(id)]);
const tr=(key,args)=>t('inventoryData',key,args);
export function createResourcesUI(services){let context;const tags=resourceTagsUI();
 const category=async id=>{const reply=await services.api('/api/modules/item',{workspaceId:services.state.book.id,id});if(reply.workspaceId!==services.state.book.id||reply.entity?.id!==id||reply.entity.type!=='category'||!Array.isArray(reply.entity.data.fields))throw Error(tr('invalid'));return reply.entity;};
 const applyCategory=(draft,value)=>{draft.data.categoryId=value?.id??null;draft.data.schemaRevision=value?.revision??null;draft.data.fieldSchema=structuredClone(value?.data.fields??[]);draft.data.values=Object.fromEntries(draft.data.fieldSchema.filter(f=>Object.hasOwn(draft.data.values,f.key)).map(f=>[f.key,draft.data.values[f.key]]));};
 return moduleEditor(services,{
 listQuery:tags.query,listTools:tags.filters,listInput:tags.filterInput,
 id:'resources',initialType:'resource',scoped:true,paged:true,get label(){return m('inventory')},readOnly:d=>bomReadonly(d)||d.type==='bom'&&!!context?.bomOperations?.summary()&&!context.bomOperations.summary().terminal,
 setup(c){context=c;c.schema=moduleSchemaFields(c);c.inventory=inventoryClient(c,{card:inventoryCardFacts,stock:inventoryStockSection,bom:stockPreview});if(services.state.storage?.researchStorage==='catalogue'&&services.state.storage.researchFormatVersion===21){c.bomSources=bomSourcesUI(services,c);c.bomOperations=bomOperationUI(services,c);}},
 bind:c=>{c.inventory.bind();c.bomSources?.bind();c.bomOperations?.bind();},deactivate:c=>{c.inventory.stop();c.bomSources?.stop();c.bomOperations?.stop();},dispose:c=>{c.inventory.stop();c.bomSources?.stop();c.bomOperations?.stop();},afterCommand:c=>{c.inventory.invalidate();c.bomSources?.invalidate();c.bomOperations?.settled();},
 commandRequest:(run,command)=>context.bomOperations?context.bomOperations.commandRequest(run,command):run(),
 pendingCommand:(result,command)=>context.bomOperations.pendingCommand(result,command),
 itemFields:d=>d?.type==='resource'?[{key:'categoryId',type:'category',query:{archived:false},select:async item=>{const value=await category(item.id);return ()=>applyCategory(d,value);}}]:d?.type==='bom'?d.data.lines.filter(line=>!line.resourceId||localBOMResource(line,services.state.book.id)).map(line=>({key:'bom-'+line.id,type:'resource',query:{kind:'material'},get:()=>localBOMResource(line,services.state.book.id),select:async item=>{const value=await context.inventory.selected(item.id);return ()=>{line.resourceId=item.id;line.unit=value.data.unit;if(!line.value)line.value=value.data.name;};}})):[],
 summaryCard:(e,c)=>`<h2>${c.esc(e.title)}</h2>${tags.summary(e.tags,c)}${e.description?`<p>${c.esc(e.description)}</p>`:''}${e.type==='resource'?`<div data-inventory-card="${e.id}">${c.inventory.get(e.id)?inventoryCardFacts(c.inventory.get(e.id),c):c.inventory.message()}</div>`:''}`,
 get operationConflictMessage(){return m('transactionChanged')},
 availableItems:entities=>entities,entityAvailable:()=>true,scopeItems:inventoryItems,scopeControl:c=>c.current?.type==='bom'?'':inventoryScopeControl(c),
 showTabs:c=>c.current?.type!=='bom',backLabel:d=>d.type==='bom'?m('allBoms'):null,
 ownerLabel:(e,c)=>m('ownedBy',{owner:inventoryOwner(c.services.state.book,e.data.projectId)}),
 listTitle:(type,c)=>type.id==='resource'?m('inventoryTitle',{name:c.scopeId?inventoryOwner(c.services.state.book,c.scopeId):c.services.state.book.title}):type.label,
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

 get types(){return [{id:'bom',label:m('boms'),singular:m('bomType'),statuses:[['draft',m('statusDraft')],['reserved',m('statusReserved')],['finished',m('statusFinished')],['cancelled',m('statusCancelled')]],empty:m('bomEmpty')},{id:'resource',label:m('items'),singular:m('itemName'),statuses:statuses(),empty:m('itemEmpty')},{id:'category',label:m('categories'),singular:m('categoryType'),empty:m('categoryEmpty')}]},
 blank:(type,c)=>type==='bom'?newBOM():type==='category'?{name:'',description:'',fields:[],archived:false}:{projectId:null,placementId:c.creationScopeId,openingQuantity:'0',openingProjectId:c.creationScopeId,name:'',code:'',kind:'object',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'',capacity:1,status:'available',links:[],tags:[]},
 card(e,c){const d=e.data;if(e.type==='bom')return '<h2>'+c.esc(d.title)+'</h2><p>'+c.esc(m('bomCard',{record:d.recordTitle,status:statusLabel(d.status),count:d.buildCount}))+'</p>'+c.links(d.links);return `<div class="module-item-heading"><h2>${c.esc(d.name)}</h2><span class="status-badge">${c.esc(e.type==='category'?(d.archived?m('archived'):m('category')):{object:m('individualItem'),equipment:m('equipment'),material:m('materialConsumable'),software:m('softwareLicences')}[d.kind])}</span></div><p>${c.esc(proseText(d.description))}</p>${e.type==='resource'?`<p class="muted">${c.esc([d.code,d.location,statuses().find(s=>s[0]===d.status)?.[1]].filter(Boolean).join(' · '))}</p>${tags.summary(d.tags,c)}${inventoryCardFacts(e,c)}${c.links(d.links)}`:`<p>${c.esc(m('customFieldCount',{count:d.fields.length}))}</p>`}`;},
 form(d,c){
  const {input,area,select,check,field,option,esc,button}=c,v=d.data;
  if(d.type==='bom')return bomForm(d,c);
  if(d.type==='category')return `<section class="module-block"><h2>${esc(m('category'))}</h2>${input('name',m('categoryName'),'text','required maxlength="160"')}${area('description',m('description'))}${check('archived',m('archiveCategory'))}</section><section class="module-block">${c.schema.view({edit:true})}</section>`;
  return `<section class="module-block"><h2>${esc(m('itemDetails'))}</h2>${c.ownerField(m('ownedByLabel'))}<div class="form-grid">${input('name',m('itemTitle'),'text','required maxlength="240"')}${input('code',m('uniqueCode'))}${select('kind',m('itemKind'),[['object',m('generalItem')],['material',m('materialStock')],['equipment',m('bookableEquipment')],['software',m('softwareLicences')]])}${select('status',m('availability'),statuses())}${input('location',m('storagePlace'))}${stockTracked(v)?input('unit',m('stockUnit'),'text','required placeholder="'+esc(m('stockUnitExample'))+'"'):v.kind==='equipment'?input('capacity',m('simultaneousPlaces'),'number','required min="1" step="1"'):''}</div>${d.expectedRevision===null?(stockTracked(v)?`<div class="form-grid">${input('openingQuantity',m('openingQuantity'),'text','required inputmode="decimal"')}${select('openingProjectId',m('initiallyHeld'),inventoryPlaces(c).map(([id,label])=>[id??'',label]))}</div>`:select('placementId',m('heldAt'),inventoryPlaces(c).map(([id,label])=>[id??'',label]))):stockTracked(v)?'<p class="muted">'+esc(m('stockHelp'))+'</p>':`<p>${esc(m('placementHelp',{location:inventoryLocation(c.services.state.book,assetPlacement(c.get(d.id)))}))}</p>`}${area('description',m('descriptionNotes'))}${tags.field(d,c)}</section><section class="module-block"><h2>${esc(m('categoryFields'))}</h2>${c.itemField('categoryId',tr('chooseCategory'))}${v.categoryId?`<p>${esc(tr('categoryRevision',{revision:v.schemaRevision}))}</p>${button(m('applyCategory'),'upgrade-schema')}${button(tr('clearCategory'),'clear-category')}`:''}${c.schema.view()}</section>${c.referenceFields()}`;
 },
 sections:d=>d.type==='bom'?[['stock',m('buildStock')]]:d.type==='resource'?[['stock',stockTracked(d.data)?m('stockAllocations'):m('placement')],['connections',m('connections')]]:[],
 section(name,c){
  if(c.current.type==='bom')return bomStock(c);
  if(name==='stock')return `<div data-inventory-stock>${c.inventory.loading||c.inventory.error?c.inventory.message():inventoryStockSection(c)}</div>`;
  return '<section class="module-block"><h2>'+c.esc(m('connectedWork'))+'</h2><div data-inventory-links>'+c.inventory.connectionView()+'</div></section>';
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
