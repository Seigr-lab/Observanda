import {workspaceModules} from '../src/modules/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {validateBOM,bomDefinitions} from '../src/modules/bom.js';
import {resourceDefinitions,validateResources} from '../src/modules/resources.js';
import {validateBOMReceipt,validateExternalBOMStock,validateManagedReservation} from '../src/modules/bom-integrity.js';
import {validateBOMSource} from '../src/modules/bom-constraints.js';
import {moduleConstraint,moduleCommandOriginals} from '../src/modules/constraints.js';
import {moduleReferences} from '../src/modules/references.js';
import {moduleMigrationDependencies} from '../src/project-module-ownership.js';
import {InventoryReader} from '../src/modules/inventory-reader.js';
import {inventoryQuantities} from '../src/modules/inventory-query.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';

const now='2026-01-01T00:00:00.000Z',hash='a'.repeat(64),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entity=(type,data,id=randomUUID())=>({id,type,revision:1,createdAt:now,updatedAt:now,data});
const resource=(id=randomUUID())=>entity('resource',{projectId:null,placementId:null,name:'Synthetic resistor',code:'',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},id);
function fixture(){
 const workspaceId=randomUUID(),foreign=randomUUID(),id=randomUUID(),resourceId=randomUUID(),reservationId=randomUUID(),recordId=randomUUID();
 const lines=[{...bomLine(),value:'Local resistor',resourceId},{...bomLine(),value:'External resistor',resourceId:{workspaceId:foreign,type:'resource',id:resourceId}}];
 const bom=entity('bom',{...blankBOM(),title:'Two-owner prototype',projectId:randomUUID(),recordId,recordTitle:'Synthetic build',recordRevision:hash,lines,status:'reserved',allocations:lines.map((line,i)=>({lineId:line.id,reservationId,workspaceId:i?foreign:workspaceId})),links:[{workspaceId,type:'record',id:recordId}]},id);
 const operationId=randomUUID();
 const receipt=(action,operation,line,i)=>({version:1,operationId:operation,action,sourceWorkspaceId:i?foreign:workspaceId,bom:{workspaceId,type:'bom',id},planHash:hash,decisionHash:'b'.repeat(64),lines:[{lineId:line.id,resourceId,sourceProjectId:null,reservationId,quantity:'1',unit:'items',used:action==='finish'?'0.5':'0',scrapped:action==='finish'?'0.25':'0'}],event:{commandId:randomUUID(),id:randomUUID(),ordinal:1,hash:'c'.repeat(64)}});
 bom.data.externalStock={version:1,reservation:{operationId,receipts:lines.map((line,i)=>receipt('reserve',operationId,line,i))},settlement:null};
 const finish=()=>{const copy=structuredClone(bom),settlementId=randomUUID();copy.data.status='finished';copy.data.usage=lines.map(line=>({lineId:line.id,used:'0.5',scrapped:'0.25'}));copy.data.externalStock.settlement={operationId:settlementId,receipts:lines.map((line,i)=>receipt('finish',settlementId,line,i))};return copy;};
 return {workspaceId,foreign,bom,resourceId,reservationId,finish};
}
function managed(f,{status='active',settlement=false}={}){
 const receipt=f.bom.data.externalStock.reservation.receipts[1],line=receipt.lines[0];
 return entity('reservation',{projectId:null,resourceId:f.resourceId,quantity:'1',unit:'items',reason:'Managed prototype',status,links:[receipt.bom],managed:{version:1,bom:receipt.bom,operationId:receipt.operationId,lineId:line.lineId,planHash:receipt.planHash,...(settlement?{settlement:{operationId:randomUUID(),action:'finish',decisionHash:hash,used:'0.5',scrapped:'0.25'}}:{})}},f.reservationId);
}
function source(entities,{workspaceId,changes=null,previous=new Map(),get}={}){
 const values=new Map(entities.map(value=>[value.id,moduleConstraint(value)]));
 return {workspaceId,changes,previous:async id=>previous.get(id)?moduleConstraint(previous.get(id)):null,get:async id=>get?get(id,values):values.get(id)??null,async *all(types){for(const value of values.values())if(!types||(Array.isArray(types)?types:[types]).includes(value.type))yield value;}};
}

test('retained mixed-owner BOM receipts validate offline with duplicate UUIDs and exact used/scrapped quantities',async()=>{
 const f=fixture();workspaceModules({root:'.'}).validateEntity(f.bom);validateBOM(f.bom.data);validateExternalBOMStock(f.bom.data,f.workspaceId,f.bom.id);
 const finished=f.finish();validateBOM(finished.data);bomDefinitions.validate[0]([finished],{workspaceId:f.workspaceId});
 await validateBOMSource(source([finished],{workspaceId:f.workspaceId,get(){throw Error('A retained foreign receipt must not open a source ledger');}}));
 const cancelled=structuredClone(f.bom);cancelled.data.status='cancelled';const operationId=randomUUID();cancelled.data.externalStock.settlement={operationId,receipts:cancelled.data.externalStock.reservation.receipts.map(value=>({...value,operationId,action:'cancel'}))};validateBOM(cancelled.data);
});

test('retained BOM receipts reject incomplete, forged-owner, reused-operation and altered quantity coverage',()=>{
 const f=fixture();
 const changes=[
  value=>value.externalStock.reservation.receipts.pop(),
  value=>value.externalStock.reservation.receipts.push(structuredClone(value.externalStock.reservation.receipts[0])),
  value=>value.externalStock.reservation.receipts[1].lines[0].quantity='2',
  value=>value.externalStock.reservation.receipts[1].sourceWorkspaceId=f.workspaceId,
  value=>value.externalStock.reservation.receipts[1].bom.id=randomUUID(),
  value=>value.externalStock.reservation.receipts[1].event.hash='bad',
  value=>value.externalStock.reservation.receipts[1].decisionHash='d'.repeat(64),
  value=>value.allocations[1].workspaceId=f.workspaceId,
  value=>value.externalStock.reservation.receipts[1].lines[0].used='1'
 ];
 for(const change of changes){const data=structuredClone(f.bom.data);change(data);assert.throws(()=>validateBOM(data),{code:'MODULE_INVALID'});}
 for(const change of [value=>value.externalStock.settlement.operationId=value.externalStock.reservation.operationId,value=>value.usage[0].used='0.6',value=>value.externalStock.settlement.receipts[1].lines[0].reservationId=randomUUID()]){const data=f.finish().data;change(data);assert.throws(()=>validateBOM(data),{code:'MODULE_INVALID'});}
 assert.throws(()=>validateExternalBOMStock(f.bom.data,randomUUID(),f.bom.id),{code:'MODULE_INVALID'});
 const receipt=structuredClone(f.bom.data.externalStock.reservation.receipts[0]);receipt.lines[0].secret='not part of evidence';assert.throws(()=>validateBOMReceipt(receipt),{code:'MODULE_INVALID'});
});

test('managed source reservation states retain exact owner binding and reject forged settlement fields',()=>{
 const f=fixture(),hold=managed(f);resourceDefinitions.types.reservation(hold.data);
 const aborted=structuredClone(hold);aborted.data.status='released';validateManagedReservation(aborted.data);
 const settled=managed(f,{status:'settled',settlement:true});validateManagedReservation(settled.data);
 for(const change of [value=>value.status='consumed',value=>value.managed.settlement={...settled.data.managed.settlement,action:'cancel'},value=>value.links=[],value=>value.managed.planHash='x',value=>value.managed.secret='not allowed']){const data=structuredClone(settled.data);change(data);assert.throws(()=>validateManagedReservation(data),{code:'MODULE_INVALID'});}
 const active=structuredClone(settled);active.data.status='active';assert.throws(()=>validateManagedReservation(active.data),{code:'MODULE_INVALID'});
});

test('managed reservation commands cannot manually resolve, change live resource status or forge authored bindings',async()=>{
 const f=fixture(),reservation=managed(f),r=resource(f.resourceId),values=new Map([[reservation.id,reservation],[r.id,r]]),writes=[];
 const tx={book:{id:f.foreign,projects:[]},get:id=>values.get(id),expect(){},put(...args){writes.push(args);},some:async(types,predicate)=>[...values.values()].some(value=>(Array.isArray(types)?types:[types]).includes(value.type)&&predicate(value))};
 await assert.rejects(resourceDefinitions.commands['stock.resolve'](tx,{id:reservation.id,expectedRevision:1,decision:'release'}),{code:'MODULE_INVALID'});
 await assert.rejects(resourceDefinitions.commands['resource.save'](tx,{id:r.id,expectedRevision:1,data:{...r.data,status:'hold'}}),{code:'MODULE_INVALID'});
 await assert.rejects(resourceDefinitions.commands['stock.reserve'](tx,{resourceId:r.id,expectedRevision:1,projectId:null,quantity:'1',reason:'Fake',links:[],managed:reservation.data.managed}),{code:'MODULE_INVALID'});
 assert.deepEqual(writes,[]);
});

test('qualified BOM references hydrate only the selected owner and preserve foreign dependency addresses',async()=>{
 const f=fixture(),selected=[],catalogue={async selected(_head,id){selected.push(id);return id===f.bom.id?f.bom:null;}};
 await moduleCommandOriginals(catalogue,{}, {workspaceId:f.workspaceId,payload:{id:f.bom.id,data:{lines:[f.bom.data.lines[1]]},resources:[{id:f.bom.data.lines[1].resourceId,revision:1}]}});
 assert.deepEqual(new Set(selected),new Set([f.bom.id,f.resourceId,f.reservationId]));
 const foreignOnly=structuredClone(f.bom);foreignOnly.data.lines=[foreignOnly.data.lines[1]];foreignOnly.data.allocations=[foreignOnly.data.allocations[1]];selected.length=0;
 await moduleCommandOriginals({async selected(_head,id){selected.push(id);return foreignOnly;}},{},{workspaceId:f.workspaceId,payload:{id:f.bom.id}});assert.deepEqual(selected,[f.bom.id]);
 const dependencies=[...moduleMigrationDependencies(foreignOnly,f.workspaceId)];assert.ok(dependencies.some(value=>value.kind==='external'&&value.type==='resource'&&value.workspaceId===f.foreign&&value.id===f.resourceId));assert.ok(dependencies.some(value=>value.kind==='external'&&value.type==='reservation'&&value.workspaceId===f.foreign));assert.ok(!dependencies.some(value=>value.kind==='module'));
 assert.ok(moduleReferences(foreignOnly).links.some(value=>value.workspaceId===f.foreign&&value.type==='resource'&&value.id===f.resourceId));
});

test('foreign BOM draft changes require captured source validation while unchanged selections need no source access',async()=>{
 const f=fixture(),draft=structuredClone(f.bom);draft.data.status='draft';draft.data.allocations=[];delete draft.data.externalStock;draft.data.lines=[draft.data.lines[1]];
 let stored=null,old=null;const checked=[];
 const tx={book:{id:f.workspaceId,projects:[{id:draft.data.projectId}],notebooks:[{id:randomUUID(),projectId:draft.data.projectId}]},get:id=>id===draft.id?old:undefined,expect(){},recordSummary:async()=>({id:draft.data.recordId,notebookId:tx.book.notebooks[0].id,title:draft.data.recordTitle,revision:hash}),put(_type,_id,data){stored=structuredClone(data);}};
 const command=()=>bomDefinitions.commands['bom.save'](tx,{id:draft.id,expectedRevision:old?.revision??null,data:draft.data});
 await assert.rejects(command(),{code:'MODULE_REFERENCE'});
 tx.bomResources={async validate(reference,options){checked.push({reference,options});}};await command();assert.equal(checked.length,1);assert.equal(checked[0].reference.workspaceId,f.foreign);
 old={...draft,data:stored};delete tx.bomResources;draft.data.title='Cosmetic title';await command();assert.equal(checked.length,1);
 draft.data.lines[0].sourceProjectId=randomUUID();await assert.rejects(command(),{code:'MODULE_REFERENCE'});
});

test('managed source integrity checks local movement totals and immutable binding without foreign reads',async()=>{
 const f=fixture(),reservation=managed(f,{status:'settled',settlement:true}),r=resource(f.resourceId),opening=entity('movement',{projectId:null,resourceId:r.id,delta:'10',unit:'items',reason:'Opening',links:[],reservationId:null}),movement=entity('movement',{projectId:null,resourceId:r.id,delta:'-0.75',unit:'items',reason:'Use and scrap',links:[],reservationId:reservation.id}),values=[r,opening,movement,reservation];
 validateResources(values);await validateBOMSource(source(values,{workspaceId:f.foreign}));
 const damaged=structuredClone(movement);damaged.data.delta='-0.5';assert.throws(()=>validateResources([r,opening,damaged,reservation]),{code:'MODULE_INVALID'});await assert.rejects(validateBOMSource(source([r,opening,damaged,reservation],{workspaceId:f.foreign})),{code:'MODULE_INVALID'});
 const prior=managed(f),changed=structuredClone(reservation);changed.data.managed.planHash='e'.repeat(64);
 await assert.rejects(validateBOMSource(source([r,movement,changed],{workspaceId:f.foreign,changes:new Map([[changed.id,changed]]),previous:new Map([[prior.id,prior]])})),{code:'MODULE_INVALID'});
 const stripped=structuredClone(prior);delete stripped.data.managed;await assert.rejects(validateBOMSource(source([r,stripped],{workspaceId:f.foreign,changes:new Map([[stripped.id,stripped]]),previous:new Map([[prior.id,prior]])})),{code:'MODULE_INVALID'});
});

test('source inventory counts managed used/scrapped totals and one build across several local reservations',async()=>{
 const f=fixture(),r=resource(f.resourceId),first=managed(f,{status:'settled',settlement:true}),second=structuredClone(first);second.id=randomUUID();second.data.managed.lineId=randomUUID();
 const opening=entity('movement',{projectId:null,resourceId:r.id,delta:'10',unit:'items',reservationId:null}),movement=entity('movement',{projectId:null,resourceId:r.id,delta:'-1.5',unit:'items',reservationId:first.id}),foreignResult=f.finish(),entities=[r,first,second,opening,movement,foreignResult],map=new Map(entities.map(value=>[value.id,value]));
 const context={head:{workspaceId:f.foreign},book:{id:f.foreign},member:async id=>map.get(id),constraint:async member=>moduleConstraint(member),view:async member=>({title:member.data.name??'',id:member.id}),async *members(){yield* entities;},selected(){throw Error('Inventory quantities must not read originals');}};
 const stock=(await inventoryQuantities(context,[r.id])).get(r.id);assert.deepEqual(stock.usage,{used:'1',scrapped:'0.5',builds:1});assert.equal(stock.locations[0].builds,1);assert.equal(stock.locations[0].physical,'8.5');
});

test('legacy local BOM and reservation fact encodings are unchanged',()=>{
 const id='11111111-1111-4111-8111-111111111111',resourceId='22222222-2222-4222-8222-222222222222',lineId='33333333-3333-4333-8333-333333333333',data={status:'reserved',buildCount:'2',allocations:[{lineId,reservationId:id}],usage:[],lines:[{id:lineId,resourceId,sourceProjectId:null,unit:'items',quantity:'1',dnp:false}]};
 const value={id,type:'bom',data};assert.deepEqual(moduleConstraint(value),value);assert.equal(digest(moduleConstraint(value)),'d7159d7fab08c9189954a71b3ab91632461f1dc89d7e3eccd71a74f05e7f9521');
 const reservation={id,type:'reservation',data:{resourceId,projectId:null,quantity:'2',unit:'items',status:'active',links:[]}};assert.deepEqual(moduleConstraint(reservation),reservation);assert.deepEqual(moduleReferences(reservation),{links:[],projectId:null,ownerId:null});
});

test('retained receipt coverage stays bounded at 200 lines and 32 source owners',()=>{
 const f=fixture(),build=(owners,count)=>{
  const data=structuredClone(f.bom.data),names=Array.from({length:owners},()=>randomUUID()),template=data.externalStock.reservation.receipts[0],receiptByOwner=new Map();data.lines=[];data.allocations=[];
  for(let index=0;index<count;index++){
   const workspaceId=names[index%owners],line={...bomLine(),value:'Synthetic component '+index,resourceId:{workspaceId,type:'resource',id:randomUUID()}},reservationId=randomUUID();data.lines.push(line);data.allocations.push({lineId:line.id,reservationId,workspaceId});
   if(!receiptByOwner.has(workspaceId))receiptByOwner.set(workspaceId,{...structuredClone(template),sourceWorkspaceId:workspaceId,lines:[]});
   receiptByOwner.get(workspaceId).lines.push({lineId:line.id,resourceId:line.resourceId.id,sourceProjectId:null,reservationId,quantity:'1',unit:'items',used:'0',scrapped:'0'});
  }
  data.externalStock.reservation.receipts=[...receiptByOwner.values()];return data;
 };
 validateBOM(build(32,200));assert.throws(()=>validateBOM(build(33,200)),{code:'MODULE_INVALID'});assert.throws(()=>validateBOM(build(32,201)),{code:'MODULE_INVALID'});
});

test('a managed reservation page identifies its BOM controls without scanning unrelated BOMs',async()=>{
 const f=fixture(),reservation=managed(f),context={head:{revision:1},selected:async()=>reservation,async *members(){throw Error('Managed source ledger must not scan unrelated BOM owners');}};
 const reader=new InventoryReader(null,{reader:{modules:workspaceModules({root:'.'}),list:async()=>({revision:1,items:[{id:reservation.id}],total:1}),context:async(_namespace,consume)=>consume(context)}});
 const page=await reader.ledger({workspaceId:f.foreign,resourceId:f.resourceId,kind:'reservations'});assert.deepEqual(page.managed,[reservation.id]);
});

test('changed retained BOM receipts validate without scanning unrelated local stock history',async()=>{
 const f=fixture(),finished=f.finish(),current=source([finished],{workspaceId:f.workspaceId,changes:new Map([[finished.id,finished]])});
 current.all=async function*(){throw Error('Receipt-only BOM update must not scan an inventory ledger');};
 await validateBOMSource(current);
 const corrupted=structuredClone(finished);corrupted.data.externalStock.settlement.receipts[0].lines[0].used='1';current.changes=new Map([[corrupted.id,corrupted]]);
 await assert.rejects(validateBOMSource(current),{code:'MODULE_INVALID'});
});
