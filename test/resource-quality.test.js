import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {fixture as projectFixture} from './project-domain-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {AppError} from '../src/errors.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';
import {balance} from '../src/web/modules/quantities.js';
import {validResourceQuality,qualityAssessment,qualityDay} from '../src/web/modules/resource-quality.js';
import {observedResourceQuality,validObservedQuality} from '../src/modules/resource-quality.js';
import {resourceQualityFormat} from '../src/resource-quality-domain.js';
import {moduleErrorMessage,moduleErrorDetail} from '../src/web/modules/module-validation-presentation.js';
import {prepareLanguage,activateLanguage} from '../src/web/i18n/index.js';

const policy=(overrides={})=>({reserve:'warn',use:'warn',run:'warn',...overrides});
const lot=(overrides={})=>({version:1,kind:'lot',number:'LOT-42',supplier:'Synthetic supplier',evidence:null,expiresOn:null,retestOn:null,holdReason:'',policy:policy(),...overrides});
const instrument=(overrides={})=>({version:1,kind:'equipment',certificate:null,coverage:null,holdReason:'',policy:policy(),...overrides});
const reference=(kind='analysis')=>({kind,id:randomUUID(),revision:'a'.repeat(64),workspaceId:randomUUID()});
const coverage={from:'2026-01-01',expiry:'dated',through:'2026-12-31'};
const blocked=check=>error=>{assert.equal(error.code,'RESOURCE_QUALITY_BLOCK');check?.(error.details);return true;};

test('readiness rules validate lot and equipment qualification exactly',()=>{
 assert.equal(validResourceQuality(lot(),'material'),true);
 assert.equal(validResourceQuality(lot({evidence:reference('dataset'),expiresOn:'2026-12-31',retestOn:'2026-06-30'}),'material'),true);
 assert.equal(validResourceQuality(lot(),'equipment'),false,'A lot belongs to material stock');
 assert.equal(validResourceQuality(instrument(),'equipment'),true);
 assert.equal(validResourceQuality(instrument({certificate:reference(),coverage}),'equipment'),true);
 assert.equal(validResourceQuality(instrument(),'material'),false,'Calibration belongs to equipment');
 for(const invalid of [
  lot({number:''}),lot({number:'   '}),lot({expiresOn:'2026-02-30'}),lot({retestOn:'31/12/2026'}),lot({holdReason:'Line\nbreak'}),lot({holdReason:'x'.repeat(501)}),
  lot({policy:policy({use:'ignore'})}),lot({policy:{reserve:'warn',use:'warn'}}),{...lot(),extra:true},lot({version:2}),lot({evidence:{kind:'analysis',id:'x',revision:'y',workspaceId:'z'}})
 ])assert.equal(validResourceQuality(invalid,'material'),false,JSON.stringify(invalid));
 for(const invalid of [
  instrument({certificate:reference()}),instrument({coverage}),instrument({certificate:reference('dataset'),coverage}),
  instrument({certificate:reference(),coverage:{from:'2026-12-31',expiry:'dated',through:'2026-01-01'}}),{...instrument(),number:'LOT-1'}
 ])assert.equal(validResourceQuality(invalid,'equipment'),false,JSON.stringify(invalid));
});

test('assessments derive issues from declared dates and block only under a block rule',()=>{
 const on='2026-05-01';
 assert.deepEqual(qualityAssessment(lot(),'use',on),{workflow:'use',on,policy:'warn',issues:[],blocked:false});
 assert.deepEqual(qualityAssessment(lot({holdReason:'Awaiting certificate'}),'use',on).issues,['hold']);
 assert.deepEqual(qualityAssessment(lot({expiresOn:on}),'use',on).issues,[],'A lot is usable on its expiry date');
 assert.deepEqual(qualityAssessment(lot({expiresOn:'2026-04-30'}),'use',on).issues,['expired']);
 assert.deepEqual(qualityAssessment(lot({retestOn:on}),'use',on).issues,['retest'],'Retest is due on its date');
 assert.deepEqual(qualityAssessment(lot({retestOn:'2026-05-02'}),'use',on).issues,[]);
 assert.deepEqual(qualityAssessment(lot({holdReason:'Held',expiresOn:'2026-01-01',retestOn:'2026-01-01'}),'run',on).issues,['hold','expired','retest']);
 const strict=lot({holdReason:'Held',policy:policy({use:'block'})});
 assert.equal(qualityAssessment(strict,'use',on).blocked,true);
 assert.equal(qualityAssessment(strict,'reserve',on).blocked,false,'Each workflow applies its own rule');
 assert.equal(qualityAssessment(lot({policy:policy({use:'block'})}),'use',on).blocked,false,'A block rule without issues allows use');
 assert.deepEqual(qualityAssessment(instrument(),'run',on).issues,['calibration-missing']);
 const calibrated=instrument({certificate:reference(),coverage});
 assert.deepEqual(qualityAssessment(calibrated,'run','2026-06-01').issues,[]);
 assert.deepEqual(qualityAssessment(calibrated,'run','2025-12-31').issues,['calibration-future']);
 assert.deepEqual(qualityAssessment(calibrated,'run','2027-01-01').issues,['calibration-expired']);
 assert.deepEqual(qualityAssessment(instrument({certificate:reference(),coverage:{from:null,expiry:'unknown',through:null}}),'run','2026-06-01').issues,['calibration-unknown']);
 assert.equal(qualityAssessment(instrument({policy:policy({run:'block'})}),'run',on).blocked,true);
 assert.throws(()=>qualityAssessment(lot(),'ship',on),TypeError);
 assert.throws(()=>qualityAssessment(lot(),'use','2026-5-1'),TypeError);
 assert.equal(qualityDay('2026-06-30T23:30:00.000Z'),'2026-06-30');
 assert.equal(qualityDay('2026-06-30T13:00:00.000Z','Pacific/Auckland'),'2026-07-01');
 assert.equal(qualityDay('2026-07-01T03:00:00.000Z','America/Los_Angeles'),'2026-06-30');
});

test('observed snapshots are exact, recomputable and never record a blocked use',async t=>{
 const id=randomUUID(),resource=quality=>({id,revision:3,data:{name:'Buffer solution',...(quality?{quality}:{})}});
 assert.deepEqual(observedResourceQuality(resource(null),'use','2026-05-01T10:00:00.000Z'),{});
 const {qualityAtUse}=observedResourceQuality(resource(lot({holdReason:'Awaiting certificate'})),'use','2026-05-01T10:00:00.000Z');
 assert.deepEqual(Object.keys(qualityAtUse).sort(),['blocked','issues','name','on','policy','quality','resourceId','resourceRevision','version','workflow']);
 assert.equal(qualityAtUse.resourceRevision,3);assert.equal(qualityAtUse.on,'2026-05-01');assert.deepEqual(qualityAtUse.issues,['hold']);
 assert.equal(validObservedQuality(qualityAtUse,id),true);
 assert.equal(validObservedQuality(qualityAtUse,randomUUID()),false,'A snapshot belongs to one resource');
 for(const tampered of [{...qualityAtUse,issues:[]},{...qualityAtUse,policy:'block'},{...qualityAtUse,blocked:true},{...qualityAtUse,resourceRevision:0},{...qualityAtUse,on:'2026-13-01'},{...qualityAtUse,quality:{...qualityAtUse.quality,number:''}},{...qualityAtUse,extra:1}])
  assert.equal(validObservedQuality(tampered,id),false,JSON.stringify(tampered));
 const blockedQuality=lot({holdReason:'Awaiting certificate',policy:policy({use:'block'})});
 const forged={...qualityAtUse,quality:blockedQuality,policy:'block',blocked:true};
 assert.equal(validObservedQuality(forged,id),false,'A blocked assessment is never a recorded use');
 let error;try{observedResourceQuality(resource(blockedQuality),'use','2026-05-01T10:00:00.000Z');}catch(e){error=e;}
 assert.ok(error instanceof AppError);assert.equal(error.code,'RESOURCE_QUALITY_BLOCK');
 assert.deepEqual(error.details,[{resourceId:id,name:'Buffer solution',workflow:'use',on:'2026-05-01',policy:'block',issues:['hold'],blocked:true,reason:'Awaiting certificate'}]);
 const fetcher=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
 t.after(()=>activateLanguage('en'));await prepareLanguage('en',{fetcher});activateLanguage('en');
 assert.equal(moduleErrorMessage(error),'The selected lot or equipment is blocked by its readiness rule.');
 assert.equal(moduleErrorDetail(error.details[0]),'Buffer solution · Blocked · On hold · Awaiting certificate');
});

test('the readiness format marker is accepted only in owning domains and only at version 1',()=>{
 assert.equal(resourceQualityFormat({},'inventory'),0);
 for(const domain of ['inventory','equipment','samples'])assert.equal(resourceQualityFormat({resourceQualityFormat:1},domain),1);
 assert.throws(()=>resourceQualityFormat({resourceQualityFormat:1},'bom'),{code:'CATALOGUE_DAMAGED'});
 assert.throws(()=>resourceQualityFormat({resourceQualityFormat:0},'inventory'),{code:'CATALOGUE_DAMAGED'});
 assert.throws(()=>resourceQualityFormat({resourceQualityFormat:'1'},'inventory'),{code:'CATALOGUE_DAMAGED'});
 assert.throws(()=>resourceQualityFormat({resourceQualityFormat:2},'inventory'),{code:'ACCESS_UPGRADE'});
});

async function workspace(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-resource-quality-')),book=upgradeNotebook(sampleNotebook());
 const f=await encryptedFixture(directory,book),store=workspaceModules(f.workspace);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const cmd=(action,payload,commandId=randomUUID())=>store.execute({workspaceId:book.id,commandId,action,payload});
 const all=async()=>(await store.current()).entities,get=async id=>(await all()).find(e=>e.id===id);
 const create=async(name,kind,quality,quantity='100')=>{const id=randomUUID();await cmd('resource.create',{id,data:{projectId:null,placementId:null,name,code:'',kind,description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:kind==='material'?'mL':'',capacity:1,status:'available',links:[],...(quality?{quality}:{})},openingStock:{quantity:kind==='material'?quantity:'0',projectId:null}});return id;};
 const update=async(id,change)=>{const r=await get(id);return cmd('resource.save',{id,expectedRevision:r.revision,data:change(structuredClone(r.data))});};
 const move=async(id,delta,extra={})=>cmd('stock.move',{resourceId:id,expectedRevision:(await get(id)).revision,projectId:null,delta,reason:'Synthetic use',links:[],...extra});
 return {...f,book,store,cmd,all,get,create,update,move};
}

test('stock use, reservations and their resolution observe the lot rule; snapshots keep the readiness of their moment',async t=>{
 const s=await workspace(t),id=await s.create('Buffer solution','material',lot({holdReason:'Awaiting certificate',policy:policy({use:'block'})}));
 const opening=(await s.all()).find(e=>e.type==='movement'&&e.data.resourceId===id);
 assert.equal(opening.data.reason,'Opening stock');assert.equal(Object.hasOwn(opening.data,'qualityAtUse'),false,'Receipts are not uses');
 await assert.rejects(s.move(id,'-5'),{code:'MODULE_INVALID'},'A qualified lot names actual use or reconciliation');
 await assert.rejects(s.move(id,'3',{useKind:'used'}),{code:'MODULE_INVALID'},'Receipts carry no use kind');
 const before=balance(await s.all(),id);
 await assert.rejects(s.move(id,'-5',{useKind:'used'}),blocked(details=>{assert.equal(details[0].resourceId,id);assert.deepEqual(details[0].issues,['hold']);assert.equal(details[0].reason,'Awaiting certificate');}));
 assert.deepEqual(balance(await s.all(),id),before,'A blocked use writes nothing');
 await s.move(id,'-2',{useKind:'adjusted'});
 const adjustment=(await s.all()).find(e=>e.type==='movement'&&e.data.delta==='-2');
 assert.equal(Object.hasOwn(adjustment.data,'qualityAtUse'),false,'Reconciliation is not a use of the lot');
 const heldRevision=(await s.get(id)).revision;
 await s.cmd('stock.reserve',{resourceId:id,expectedRevision:heldRevision,projectId:null,quantity:'10',reason:'Planned titration',links:[]});
 const reservation=(await s.all()).find(e=>e.type==='reservation');
 assert.equal(reservation.data.qualityAtUse.workflow,'reserve');assert.equal(reservation.data.qualityAtUse.resourceRevision,heldRevision);
 assert.deepEqual(reservation.data.qualityAtUse.issues,['hold']);assert.equal(reservation.data.qualityAtUse.blocked,false,'Reservation uses its own warning rule');
 await assert.rejects(s.cmd('stock.resolve',{id:reservation.id,expectedRevision:reservation.revision,decision:'consume'}),blocked());
 await assert.rejects(s.update(id,d=>({...d,quality:{...d.quality,number:'LOT-43'}})),{code:'MODULE_INVALID'},'A lot number identifies one ledger');
 await assert.rejects(s.update(id,d=>{delete d.quality;return d;}),{code:'MODULE_INVALID'},'Qualified inventory keeps its history');
 await assert.rejects(s.update(id,d=>({...d,quality:{...d.quality,policy:{...d.quality.policy,use:'skip'}}})),{code:'MODULE_INVALID'});
 await s.update(id,d=>({...d,quality:{...d.quality,holdReason:''}}));
 const released=await s.get(id);
 await s.cmd('stock.resolve',{id:reservation.id,expectedRevision:(await s.get(reservation.id)).revision,decision:'consume'});
 const entities=await s.all(),consumed=entities.find(e=>e.type==='movement'&&e.data.reservationId===reservation.id);
 assert.equal(consumed.data.useKind,'used');assert.deepEqual(consumed.data.qualityAtUse.issues,[]);assert.equal(consumed.data.qualityAtUse.resourceRevision,released.revision);
 assert.equal(consumed.data.qualityAtUse.workflow,'use');assert.equal(consumed.data.qualityAtUse.policy,'block');
 assert.deepEqual(entities.find(e=>e.id===reservation.id).data.qualityAtUse,reservation.data.qualityAtUse,'Later changes never rewrite the reservation snapshot');
 await s.move(id,'-1',{useKind:'used'});
 const used=(await s.all()).find(e=>e.type==='movement'&&e.data.delta==='-1');
 assert.equal(used.data.useKind,'used');assert.equal(validObservedQuality(used.data.qualityAtUse,id),true);
 const expired=await s.create('Expired reagent','material',lot({number:'OLD-1',expiresOn:'2000-01-01'}));
 await s.move(expired,'-1',{useKind:'used'});
 const warned=(await s.all()).find(e=>e.type==='movement'&&e.data.resourceId===expired&&e.data.useKind==='used');
 assert.deepEqual(warned.data.qualityAtUse.issues,['expired'],'A warning rule records the issue with the use');
 await assert.rejects(s.create('Unqualified lot','equipment',lot()),{code:'MODULE_INVALID'});
 await s.workspace.catalogue(store=>s.store.verifyCatalogue(store,s.book.id));
});

test('equipment bookings record readiness at reservation and refuse blocked work bookings',async t=>{
 const s=await workspace(t),id=await s.create('Analytical balance','equipment',instrument({policy:policy({reserve:'block'})}));
 const booking=(overrides={})=>({projectId:null,title:'Weighing',resourceId:id,startsAt:'2026-10-15T12:00:00.000Z',endsAt:'2026-10-15T13:00:00.000Z',timeZone:'Pacific/Auckland',places:1,kind:'work',status:'confirmed',notes:'',links:[],...overrides});
 const save=(bookingId,data,expectedRevision=null)=>s.cmd('booking.save',{id:bookingId,expectedRevision,data});
 await assert.rejects(save(randomUUID(),booking()),blocked(details=>assert.deepEqual(details[0].issues,['calibration-missing'])));
 const maintenance=randomUUID();await save(maintenance,booking({kind:'maintenance',title:'Calibration visit',startsAt:'2026-10-15T14:00:00.000Z',endsAt:'2026-10-15T15:00:00.000Z'}));
 assert.equal(Object.hasOwn((await s.get(maintenance)).data,'qualityAtReservation'),false,'Maintenance does not use the instrument');
 const cancelled=randomUUID();await save(cancelled,booking({status:'cancelled',startsAt:'2026-10-15T16:00:00.000Z',endsAt:'2026-10-15T17:00:00.000Z'}));
 assert.equal(Object.hasOwn((await s.get(cancelled)).data,'qualityAtReservation'),false);
 await s.update(id,d=>({...d,quality:{...d.quality,policy:policy()}}));
 const work=randomUUID();await save(work,booking());
 const saved=await s.get(work),snapshot=saved.data.qualityAtReservation;
 assert.equal(snapshot.workflow,'reserve');assert.equal(snapshot.on,'2026-10-16','The day is read in the booking time zone');
 assert.deepEqual(snapshot.issues,['calibration-missing']);assert.equal(snapshot.resourceRevision,(await s.get(id)).revision);
 await s.update(id,d=>({...d,quality:{...d.quality,holdReason:'Draft shield cracked'}}));
 await save(work,{...saved.data,title:'Weighing standards'},saved.revision);
 assert.deepEqual((await s.get(work)).data.qualityAtReservation,snapshot,'Editing the same booking keeps its reservation evidence');
 const edited=await s.get(work);
 await save(work,{...edited.data,startsAt:'2026-10-20T12:00:00.000Z',endsAt:'2026-10-20T13:00:00.000Z'},edited.revision);
 const moved=(await s.get(work)).data.qualityAtReservation;
 assert.equal(moved.on,'2026-10-21');assert.deepEqual(moved.issues,['hold','calibration-missing'],'A new time is a new reservation');
 await assert.rejects(save(randomUUID(),{...booking(),qualityAtReservation:snapshot}),{code:'MODULE_INVALID'},'Reservation evidence is assigned by the owner');
 const forged=await s.get(work);
 await assert.rejects(save(work,{...forged.data,qualityAtReservation:{...forged.data.qualityAtReservation,issues:[]}},forged.revision),{code:'MODULE_INVALID'});
 await s.workspace.catalogue(store=>s.store.verifyCatalogue(store,s.book.id));
});

test('local bills of materials record reservation and use readiness and stop at a blocked lot',async t=>{
 const s=await workspace(t),id=await s.create('Resistor reel','material',lot({number:'R-2026',retestOn:'2000-01-01'}));
 const bom=async(quantity='2')=>{const bomId=randomUUID(),line={...bomLine(),resourceId:id,value:'4k7 resistor',quantity};await s.cmd('bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Synthetic board',recordId:s.book.entries[0].id,lines:[line]}});
  const b=await s.get(bomId);await s.cmd('bom.reserve',{id:bomId,expectedRevision:b.revision,resources:[{id,revision:(await s.get(id)).revision}]});return {bomId,line};};
 const first=await bom(),reserved=await s.get(first.bomId),reservation=await s.get(reserved.data.allocations[0].reservationId);
 assert.equal(reservation.data.qualityAtUse.workflow,'reserve');assert.deepEqual(reservation.data.qualityAtUse.issues,['retest']);
 await s.cmd('bom.finish',{id:first.bomId,expectedRevision:reserved.revision,usage:[{lineId:first.line.id,used:'1',scrapped:'1'}]});
 const movements=(await s.all()).filter(e=>e.type==='movement'&&e.data.reservationId===reservation.id);
 const usedMovement=movements.find(e=>e.data.delta==='-1'&&e.data.reason.startsWith('Used')),scrappedMovement=movements.find(e=>e.data.reason.startsWith('Scrapped'));
 assert.equal(movements.length,2);assert.equal(usedMovement.data.useKind,'used');
 assert.equal(usedMovement.data.qualityAtUse.workflow,'use');assert.deepEqual(usedMovement.data.qualityAtUse.issues,['retest']);assert.equal(validObservedQuality(usedMovement.data.qualityAtUse,id),true);
 assert.equal(Object.hasOwn(scrappedMovement.data,'qualityAtUse'),false,'Scrapping is disposal, not use');assert.equal(Object.hasOwn(scrappedMovement.data,'useKind'),false);
 const second=await bom();
 await s.update(id,d=>({...d,quality:{...d.quality,policy:policy({use:'block'})}}));
 const pending=await s.get(second.bomId);
 await assert.rejects(s.cmd('bom.finish',{id:second.bomId,expectedRevision:pending.revision,usage:[{lineId:second.line.id,used:'2',scrapped:'0'}]}),blocked());
 assert.equal((await s.get(second.bomId)).data.status,'reserved','A blocked completion leaves the reservation in place');
 await s.cmd('bom.finish',{id:second.bomId,expectedRevision:pending.revision,usage:[{lineId:second.line.id,used:'0',scrapped:'2'}]});
 const disposed=await s.get(second.bomId),disposal=(await s.all()).filter(e=>e.type==='movement'&&e.data.reservationId===disposed.data.allocations[0].reservationId);
 assert.equal(disposed.data.status,'finished','A blocked lot can still be scrapped');assert.equal(disposal.length,1);assert.equal(disposal[0].data.delta,'-2');assert.equal(Object.hasOwn(disposal[0].data,'qualityAtUse'),false);
 await s.update(id,d=>({...d,quality:{...d.quality,policy:policy({reserve:'block'})}}));
 const draftId=randomUUID(),line={...bomLine(),resourceId:id,value:'4k7 resistor',quantity:'1'};
 await s.cmd('bom.save',{id:draftId,expectedRevision:null,data:{...blankBOM(),title:'Blocked board',recordId:s.book.entries[0].id,lines:[line]}});
 await assert.rejects(s.cmd('bom.reserve',{id:draftId,expectedRevision:(await s.get(draftId)).revision,resources:[{id,revision:(await s.get(id)).revision}]}),blocked());
 assert.equal((await s.get(draftId)).data.status,'draft');
 await s.workspace.catalogue(store=>s.store.verifyCatalogue(store,s.book.id));
});

const command=(owner,action,payload)=>({workspaceId:owner.book.id,commandId:randomUUID(),action,payload});
const selected=(owner,domain,id)=>owner.domains.run([domain],async access=>{const catalogue=new ModuleCatalogue(access(domain));return catalogue.selected(await catalogue.head(owner.book.id),id);});
const entities=(owner,domain)=>owner.domains.run([domain],async access=>{const catalogue=new ModuleCatalogue(access(domain)),head=await catalogue.head(owner.book.id),values=[];for await(const member of catalogue.members(head))values.push(await catalogue.selected(head,member.id));return values;});
const verify=owner=>owner.storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:owner.book.id}));

test('mixed-owner inventory operations carry each source lot readiness through prepare, apply and verification',{timeout:240000},async t=>{
 const f=await projectFixture(t),book=sampleNotebook();book.title=book.projects[0].title='Stock owner';
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'source-device')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const storage=await initializeProjectLocation(path.join(f.root,'Stock owner'),book.projects[0].id,book,access,vault),source={book,storage,vault,domains:new ProjectDomains(storage,book.id)};
 f.commands=new ProjectModuleCommands(f.storage,f.book.id);source.commands=new ProjectModuleCommands(storage,book.id);await f.commands.initialize();await source.commands.initialize();
 const owners=new Map([[f.book.id,f],[source.book.id,source]]);
 f.inventorySourceAccess=async()=>({useOwner:async(id,consume)=>consume(owners.get(id).storage,{workspaceId:id},{check:async()=>{}}),verify:async()=>{},close:async()=>{}});
 const options={inventorySourceAccess:f.inventorySourceAccess},resourceId=randomUUID();
 const create=(owner,quality)=>owner.commands.execute(command(owner,'resource.create',{id:resourceId,data:{projectId:null,placementId:null,name:'Shared reagent',code:resourceId,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[],...(quality?{quality}:{})},openingStock:{quantity:'100',projectId:null}}));
 await create(f,null);await create(source,lot({number:'SRC-7',retestOn:'2000-01-01'}));
 const setPolicy=async rules=>{const r=await selected(source,'inventory',resourceId);await source.commands.execute(command(source,'resource.save',{id:resourceId,expectedRevision:r.revision,data:{...r.data,quality:{...r.data.quality,policy:policy(rules)}}}));};
 const foreign={workspaceId:source.book.id,type:'resource',id:resourceId};
 async function reserve(title){
  const bomId=randomUUID(),lines=[{...bomLine(),value:'Local part',resourceId,quantity:'2'},{...bomLine(),value:'Foreign part',resourceId:foreign,quantity:'3'}];
  await f.commands.execute(command(f,'bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title,recordId:f.book.entries[0].id,lines}}),options);
  const resources=[{id:resourceId,revision:(await selected(f,'inventory',resourceId)).revision},{id:foreign,revision:(await selected(source,'inventory',resourceId)).revision}];
  return {bomId,lines,result:await f.commands.execute(command(f,'bom.reserve',{id:bomId,expectedRevision:1,resources}),options)};
 }
 const first=await reserve('Qualified build');assert.equal(first.result.operationPending,undefined,JSON.stringify(first.result.operation));
 const allocations=first.result.entities.find(e=>e.id===first.bomId).data.allocations;
 for(const allocation of allocations){
  const owner=allocation.workspaceId===f.book.id?f:source,reservation=await selected(owner,'inventory',allocation.reservationId);
  if(owner===source){assert.equal(reservation.data.qualityAtUse.workflow,'reserve');assert.deepEqual(reservation.data.qualityAtUse.issues,['retest']);assert.equal(reservation.data.qualityAtUse.quality.number,'SRC-7');}
  else assert.equal(Object.hasOwn(reservation.data,'qualityAtUse'),false,'Unqualified stock records no readiness');
 }
 const usage=first.lines.map((line,index)=>({lineId:line.id,used:'2',scrapped:index?'1':'0'}));
 const finished=await f.commands.execute(command(f,'bom.finish',{id:first.bomId,expectedRevision:2,usage}),options);
 assert.equal(finished.operationPending,undefined,JSON.stringify(finished.operation));assert.equal(finished.entities[0].data.status,'finished');
 const sourceUses=(await entities(source,'inventory')).filter(e=>e?.type==='movement'&&e.data.links.some(l=>l.id===first.bomId));
 assert.equal(sourceUses.length,2);
 const sourceUse=sourceUses.find(e=>e.data.reason.startsWith('Used')),sourceScrap=sourceUses.find(e=>e.data.reason.startsWith('Scrapped'));
 assert.equal(sourceUse.data.useKind,'used');assert.equal(sourceUse.data.qualityAtUse.workflow,'use');assert.deepEqual(sourceUse.data.qualityAtUse.issues,['retest']);assert.equal(validObservedQuality(sourceUse.data.qualityAtUse,resourceId),true);
 assert.equal(Object.hasOwn(sourceScrap.data,'qualityAtUse'),false,'Scrapping is disposal, not use');assert.equal(Object.hasOwn(sourceScrap.data,'useKind'),false);
 assert.ok((await entities(f,'inventory')).filter(e=>e?.type==='movement'&&e.data.links.some(l=>l.id===first.bomId)).every(e=>!Object.hasOwn(e.data,'qualityAtUse')));
 await verify(f);await verify(source);
 const second=await reserve('Blocked completion');assert.equal(second.result.operationPending,undefined,JSON.stringify(second.result.operation));
 const disposal=await reserve('Disposal of a blocked lot');assert.equal(disposal.result.operationPending,undefined,JSON.stringify(disposal.result.operation));
 await setPolicy({use:'block'});
 const refused=await f.commands.execute(command(f,'bom.finish',{id:second.bomId,expectedRevision:2,usage:second.lines.map(line=>({lineId:line.id,used:'1',scrapped:'0'}))}),options);
 assert.equal(refused.operationPending,false);assert.equal(refused.operation.phase,'aborted');assert.equal(refused.operation.error.code,'RESOURCE_QUALITY_BLOCK');
 assert.equal((await entities(source,'inventory')).some(e=>e?.type==='movement'&&e.data.links.some(l=>l.id===second.bomId)),false,'A refused completion records no source use');
 const scrapped=await f.commands.execute(command(f,'bom.finish',{id:disposal.bomId,expectedRevision:2,usage:disposal.lines.map((line,index)=>({lineId:line.id,used:'0',scrapped:index?'3':'2'}))}),options);
 assert.equal(scrapped.operationPending,undefined,JSON.stringify(scrapped.operation));assert.equal(scrapped.entities[0].data.status,'finished','A blocked source lot can still be scrapped');
 const sourceDisposal=(await entities(source,'inventory')).filter(e=>e?.type==='movement'&&e.data.links.some(l=>l.id===disposal.bomId));
 assert.equal(sourceDisposal.length,1);assert.equal(sourceDisposal[0].data.delta,'-3');assert.equal(Object.hasOwn(sourceDisposal[0].data,'qualityAtUse'),false);
 await verify(f);await verify(source);
 await setPolicy({reserve:'block'});
 const third=await reserve('Blocked reservation');
 assert.equal(third.result.operationPending,false);assert.equal(third.result.operation.phase,'aborted');assert.equal(third.result.operation.error.code,'RESOURCE_QUALITY_BLOCK');
 assert.equal((await selected(f,'bom',third.bomId)).data.status,'draft');
});
