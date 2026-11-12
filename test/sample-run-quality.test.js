import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleDecimal} from './sample-analysis-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {workspaceModules} from '../src/modules/index.js';
import {validRunQuality} from '../src/sample-run-quality.js';
import {startServer} from '../src/server.js';

const policy=(overrides={})=>({reserve:'warn',use:'warn',run:'warn',...overrides});
const lot=(overrides={})=>({version:1,kind:'lot',number:'LOT-9',supplier:'Synthetic supplier',evidence:null,expiresOn:'2099-12-31',retestOn:null,holdReason:'',policy:policy(),...overrides});
const instrument=(overrides={})=>({version:1,kind:'equipment',certificate:null,coverage:null,holdReason:'',policy:policy(),...overrides});
const result={method:'Method 1',analyte:'Absorbance',kind:'numeric',numericVersion:2,value:sampleDecimal('0.3'),unit:'AU',lower:sampleDecimal('0'),upper:sampleDecimal('1'),notes:'Synthetic notes'};

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-run-quality-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const modules=workspaceModules(f.workspace),cmd=(action,payload)=>modules.execute({workspaceId:book.id,commandId:randomUUID(),action,payload});
 const all=async()=>(await modules.current()).entities,get=async id=>(await all()).find(e=>e.id===id);
 const create=async(name,kind,quality)=>{const id=randomUUID();await cmd('resource.create',{id,data:{projectId:null,placementId:null,name,code:'',kind,description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:kind==='material'?'mL':'',capacity:1,status:'available',links:[],...(quality?{quality}:{})},openingStock:{quantity:kind==='material'?'100':'0',projectId:null}});return id;};
 const update=async(id,change)=>{const r=await get(id);await cmd('resource.save',{id,expectedRevision:r.revision,data:change(structuredClone(r.data))});return get(id);};
 const move=async(id,delta,useKind)=>{await cmd('stock.move',{resourceId:id,expectedRevision:(await get(id)).revision,projectId:null,delta,reason:'Synthetic '+useKind,links:[],useKind});return (await all()).find(e=>e.type==='movement'&&e.data.resourceId===id&&e.data.delta===delta);};
 const service=new Laboratory(f.workspace.root,f.vault),reader=new SampleAnalysisReader(service);
 const change=(command,commandId=randomUUID())=>service.change(command,{compact:true,commandId});
 const sample=await change({action:'create-sample',etag:'new',sample:{code:'S-01',material:'Synthetic solution',source:'Test',collectedOn:'2026-10-01',receivedOn:'2026-10-01'}});
 const analyse=(code,runInputs,commandId)=>change({action:'create-analysis',etag:'new',analysis:{code,sampleId:sample.selectedId,result,...(runInputs===undefined?{}:{runInputs})}},commandId);
 const analysis=async id=>(await reader.selected({workspaceId:book.id,kind:'analysis',id})).record;
 const count=async()=>(await reader.query({workspaceId:book.id,view:'analyses'})).total;
 return {...f,book,cmd,all,get,create,update,move,service,reader,change,analyse,analysis,count};
}

test('an analysis run records the readiness of its equipment and lot uses at run time and keeps it when the items change',async t=>{
 const s=await fixture(t),equipment=await s.create('Spectrophotometer','equipment',instrument()),material=await s.create('Reference buffer','material',lot());
 const use=await s.move(material,'-3','used'),instrumentRevision=(await s.get(equipment)).revision;
 assert.equal(use.data.qualityAtUse.workflow,'use');
 const inputs=[{kind:'equipment',id:equipment,revision:instrumentRevision},{kind:'movement',id:use.id,revision:use.revision}],commandId=randomUUID();
 const before=Date.now(),created=await s.analyse('A-01',inputs,commandId);
 assert.deepEqual(await s.analyse('A-01',inputs,commandId),created,'A retried command returns its original receipt');
 const record=await s.analysis(created.selectedId),run=record.runQuality;
 assert.equal(Object.hasOwn(record,'runInputs'),false,'Only the observed snapshot is stored');
 assert.equal(validRunQuality(run),true);assert.equal(run.version,1);assert.equal(run.workspaceId,s.book.id);
 assert.ok(Date.parse(run.at)>=before-1000&&Date.parse(run.at)<=Date.now());
 const [tool,stock]=run.items;
 assert.deepEqual([tool.kind,tool.id,tool.revision],['equipment',equipment,instrumentRevision]);
 assert.equal(tool.readiness.workflow,'run');assert.equal(tool.readiness.on,run.at.slice(0,10));assert.deepEqual(tool.readiness.issues,['calibration-missing']);
 assert.equal(tool.readiness.resourceRevision,instrumentRevision);assert.equal(tool.readiness.name,'Spectrophotometer');
 assert.deepEqual([stock.kind,stock.id,stock.revision,stock.unit,stock.delta,stock.status],['movement',use.id,use.revision,'mL','-3','available']);
 assert.deepEqual(stock.stockUse,use.data.qualityAtUse,'The posted use is referenced, not repeated');
 assert.equal(stock.readiness.workflow,'run');assert.equal(stock.readiness.resourceId,material);assert.deepEqual(stock.readiness.issues,[]);assert.equal(stock.readiness.quality.number,'LOT-9');
 const physical=(await s.all()).filter(e=>e.type==='movement'&&e.data.resourceId===material).length;
 assert.equal(physical,2,'A run never debits the stock again');

 await s.update(material,d=>({...d,quality:{...d.quality,holdReason:'Contamination suspected',expiresOn:'2026-01-01'}}));
 const repaired=await s.update(equipment,d=>({...d,quality:{...d.quality,holdReason:'Lamp replaced'}}));
 assert.deepEqual((await s.analysis(created.selectedId)).runQuality,run,'Later item changes never rewrite the recorded run');
 const selected=await s.reader.selected({workspaceId:s.book.id,kind:'analysis',id:created.selectedId});
 await s.change({action:'save-result',etag:selected.etag,id:created.selectedId,expectedRecordRevision:selected.revision,result:{...result,value:sampleDecimal('0.4')}});
 const edited=await s.analysis(created.selectedId);
 assert.equal(edited.result.value.spelling,'0.4');assert.deepEqual(edited.runQuality,run,'Editing the result keeps the run evidence');

 const later=await s.analysis((await s.analyse('A-02',[{kind:'equipment',id:equipment,revision:repaired.revision},{kind:'movement',id:use.id,revision:use.revision}])).selectedId);
 assert.deepEqual(later.runQuality.items[0].readiness.issues,['hold','calibration-missing']);
 assert.deepEqual(later.runQuality.items[1].readiness.issues,['hold','expired'],'A new run observes the lot as it is now');
 assert.deepEqual(later.runQuality.items[1].stockUse,use.data.qualityAtUse,'The posted use keeps its own moment');
 assert.equal((await s.analysis((await s.analyse('A-03')).selectedId)).runQuality,undefined,'Runs without inputs stay unchanged');
 await s.service.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store);await owner.verify(await owner.source());});
});

test('run inputs refuse stale, unqualified, unused, held or blocked items without recording an analysis',async t=>{
 const s=await fixture(t),equipment=await s.create('Balance','equipment',instrument({policy:policy({run:'block'})})),material=await s.create('Solvent','material',lot());
 const plain=await s.create('Plain reagent','material',null),use=await s.move(material,'-2','used'),adjustment=await s.move(material,'-1','adjusted');
 const total=await s.count(),equipmentInput=async()=>({kind:'equipment',id:equipment,revision:(await s.get(equipment)).revision});
 await assert.rejects(s.analyse('B-01',[await equipmentInput()]),error=>{assert.equal(error.code,'RESOURCE_QUALITY_BLOCK');assert.equal(error.details[0].workflow,'run');assert.deepEqual(error.details[0].issues,['calibration-missing']);return true;});
 const stale=await equipmentInput();await s.update(equipment,d=>({...d,quality:{...d.quality,policy:policy()}}));
 await assert.rejects(s.analyse('B-02',[stale]),{code:'MODULE_CHANGED'});
 await s.update(equipment,d=>({...d,status:'hold'}));
 await assert.rejects(s.analyse('B-03',[await equipmentInput()]),{code:'BOOKING_UNAVAILABLE'});
 const movement={kind:'movement',id:use.id,revision:use.revision};
 for(const invalid of [
  [],[movement,movement],Array.from({length:65},()=>({kind:'movement',id:randomUUID(),revision:1})),
  [{...movement,extra:true}],[{...movement,kind:'resource'}],[{...movement,revision:0}],[{kind:'movement',id:adjustment.id,revision:adjustment.revision}],
  [{kind:'equipment',id:plain,revision:(await s.get(plain)).revision}],[{kind:'equipment',id:material,revision:(await s.get(material)).revision}],[{kind:'movement',id:equipment,revision:(await s.get(equipment)).revision}],'none'
 ])await assert.rejects(s.analyse('B-04',invalid),{code:'LAB_INVALID'},JSON.stringify(invalid).slice(0,120));
 await assert.rejects(s.analyse('B-05',[{kind:'movement',id:randomUUID(),revision:1}]),{code:'MODULE_CHANGED'});
 assert.equal(await s.count(),total,'No refused run is recorded');
});

test('run snapshots are validated against their own assessments',async t=>{
 const s=await fixture(t),equipment=await s.create('Pipette','equipment',instrument()),material=await s.create('Standard','material',lot());
 const use=await s.move(material,'-1','used');
 const created=await s.analyse('C-01',[{kind:'equipment',id:equipment,revision:(await s.get(equipment)).revision},{kind:'movement',id:use.id,revision:use.revision}]);
 const run=(await s.analysis(created.selectedId)).runQuality,clone=()=>structuredClone(run);
 assert.equal(validRunQuality(run),true);
 const cases=[
  value=>{value.at='2020-01-01T00:00:00.000Z';},
  value=>{value.items[0].readiness.issues=[];},
  value=>{value.items[0].revision+=1;},
  value=>{value.items[0].readiness.workflow='use';},
  value=>{value.items[1].delta='1';},
  value=>{value.items[1].stockUse.quality.number='OTHER';},
  value=>{value.items[1].stockUse.workflow='reserve';},
  value=>{value.items[1].readiness.quality={...value.items[0].readiness.quality};},
  value=>{value.items.push(structuredClone(value.items[0]));},
  value=>{value.items=[];},
  value=>{value.version=2;},
  value=>{value.extra=true;},
  value=>{value.items[1].status='retired';},
  value=>{delete value.items[1].status;},
  value=>{value.items[0].status='hold';}
 ];
 for(const change of cases){const value=clone();change(value);assert.equal(validRunQuality(value),false,change.toString());}
});

test('a laboratory without project domains refuses run inputs instead of dropping them',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-run-quality-legacy-')),lab=new Laboratory(root);
 t.after(()=>rm(root,{recursive:true,force:true}));
 await new Workspace(root).create(createNotebook('Synthetic research'));
 let current=await lab.read();current=await lab.change({action:'create-sample',etag:current.etag,sample:{code:'S-01',material:'Synthetic',source:'Test',collectedOn:'2026-10-01',receivedOn:'2026-10-01'}});
 await assert.rejects(lab.change({action:'create-analysis',etag:current.etag,analysis:{code:'A-01',sampleId:current.lab.samples[0].id,result,runInputs:[{kind:'equipment',id:randomUUID(),revision:1}]}}),{code:'ACCESS_UPGRADE'});
 assert.equal((await lab.read()).lab.analyses.length,0);
});

test('a lot use already posted stays citable after the lot is put on hold, and the run records the hold',async t=>{
 const s=await fixture(t),material=await s.create('Held buffer','material',lot({policy:policy({use:'block'})})),use=await s.move(material,'-4','used');
 await s.update(material,d=>({...d,status:'hold',quality:{...d.quality,holdReason:'Supplier recall'}}));
 await assert.rejects(s.move(material,'-1','used'),{code:'STOCK_UNAVAILABLE'},'A hold still stops new use');
 const created=await s.analyse('H-01',[{kind:'movement',id:use.id,revision:use.revision}]),run=(await s.analysis(created.selectedId)).runQuality,[item]=run.items;
 assert.equal(validRunQuality(run),true);assert.equal(item.status,'hold');assert.deepEqual(item.readiness.issues,['hold']);assert.equal(item.readiness.quality.holdReason,'Supplier recall');
 assert.deepEqual(item.stockUse.issues,[],'The posted use keeps the readiness of its own moment');
 await s.update(material,d=>({...d,status:'retired'}));
 await assert.rejects(s.analyse('H-02',[{kind:'movement',id:use.id,revision:use.revision}]),{code:'STOCK_UNAVAILABLE'},'A retired item is no longer cited');
});

test('printed and issued result sheets show readiness at run start in the requested language',async t=>{
 const s=await fixture(t),equipment=await s.create('Spectrometer','equipment',instrument()),material=await s.create('Calibrant','material',lot()),use=await s.move(material,'-2','used');
 await s.update(material,d=>({...d,status:'hold'}));
 const created=await s.analyse('R-01',[{kind:'equipment',id:equipment,revision:(await s.get(equipment)).revision},{kind:'movement',id:use.id,revision:use.revision}]);
 const selected=await s.reader.selected({workspaceId:s.book.id,kind:'analysis',id:created.selectedId});
 const submitted=await s.change({action:'save-and-submit',etag:selected.etag,id:created.selectedId,expectedRecordRevision:selected.revision,result});
 const reviewed=await s.change({action:'review',etag:submitted.etag,id:created.selectedId,reviewer:'Fixture reviewer',comment:'Checked',decision:'approve',checked:true});
 const messages=async locale=>JSON.parse(await readFile(new URL('../src/web/locales/'+locale+'/resourceQuality.json',import.meta.url),'utf8'));
 const html=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const english=await s.service.report(created.selectedId,reviewed.etag),en=await messages('en');
 assert.ok(english.includes('<section lang="en" data-run-quality><h2>'+html(en.runRecorded)+'</h2>'));
 assert.ok(english.includes('Spectrometer · '));assert.ok(english.includes('Lot or batch number LOT-9'));assert.ok(english.includes(html(en.stockUse+': -2 mL')));assert.ok(english.includes(html(en.heldAtRun)));
 assert.ok(english.indexOf('data-run-quality')<english.indexOf('Recorded review'),'Run readiness precedes the review');
 for(const locale of ['ca','es','nb','nn']){
  const sheet=await s.service.report(created.selectedId,reviewed.etag,[],{retained:true,language:locale}),text=await messages(locale);
  assert.ok(sheet.includes('<section lang="'+locale+'" data-run-quality><h2>'+html(text.runRecorded)+'</h2>'),locale);
  assert.ok(sheet.includes(html(text.heldAtRun)),locale);assert.ok(sheet.includes(html(text.lotNumber)+' LOT-9'),locale);
 }
 assert.ok((await s.service.report(created.selectedId,reviewed.etag,[],{language:'xx'})).includes('<section lang="en" data-run-quality>'),'Unknown languages fall back to English');
});

test('laboratory pages say whether run inputs can be recorded',async t=>{
 const s=await fixture(t);
 assert.equal((await s.reader.query({workspaceId:s.book.id,view:'samples'})).runInputs,true);
 assert.equal((await s.reader.query({workspaceId:s.book.id,view:'analyses'})).runInputs,true);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-run-quality-pages-')),book=createNotebook('Synthetic research');t.after(()=>rm(root,{recursive:true,force:true}));
 await new Workspace(root).create(book);const legacy=new SampleAnalysisReader(new Laboratory(root));
 assert.equal((await legacy.query({workspaceId:book.id,view:'samples'})).runInputs,false,'Older laboratories hide the run inputs');
});

test('a blocked run answers 409 with its readiness details',async t=>{
 const s=await fixture(t),equipment=await s.create('Blocked meter','equipment',instrument({policy:policy({run:'block'})}));
 const server=await startServer({root:s.workspace.root,port:0,headless:true,deviceStore:s.deviceStore});
 try{
  const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});
  assert.equal(session.status,200);const headers={'X-Observanda-Session':session.headers.get('x-observanda-session').split(';')[0],Origin:server.origin};
  headers['X-Observanda-Workspace']=(await (await fetch(server.origin+'/api/storage',{headers})).json()).contextId;
  const page=await s.reader.query({workspaceId:s.book.id,view:'samples'});
  const response=await fetch(server.origin+'/api/laboratory/change?compact=1',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({commandId:randomUUID(),action:'create-analysis',etag:page.etag,analysis:{code:'Q-01',sampleId:page.items[0].id,result,runInputs:[{kind:'equipment',id:equipment,revision:(await s.get(equipment)).revision}]}})});
  assert.equal(response.status,409);const body=await response.json();
  assert.equal(body.code,'RESOURCE_QUALITY_BLOCK');assert.equal(body.details[0].name,'Blocked meter');assert.deepEqual(body.details[0].issues,['calibration-missing']);
 }finally{await server.close();}
});

test('a posted lot use is recorded with its blocked run readiness, while new use and blocked equipment stay refused',async t=>{
 const s=await fixture(t),material=await s.create('Reagent lot','material',lot({policy:policy({run:'block'})})),use=await s.move(material,'-5','used');
 await s.update(material,d=>({...d,status:'hold',quality:{...d.quality,holdReason:'Out of specification',policy:policy({run:'block',use:'block'})}}));
 await s.update(material,d=>({...d,status:'available'}));
 await assert.rejects(s.move(material,'-1','used'),{code:'RESOURCE_QUALITY_BLOCK'},'New use stays blocked');
 await s.update(material,d=>({...d,status:'hold'}));
 const created=await s.analyse('D-01',[{kind:'movement',id:use.id,revision:use.revision}]),run=(await s.analysis(created.selectedId)).runQuality,[item]=run.items;
 assert.equal(validRunQuality(run),true);
 assert.equal(item.status,'hold');assert.equal(item.readiness.workflow,'run');assert.equal(item.readiness.policy,'block');assert.equal(item.readiness.blocked,true);
 assert.deepEqual(item.readiness.issues,['hold']);assert.equal(item.readiness.quality.holdReason,'Out of specification');
 assert.equal(item.stockUse.blocked,false,'The use itself passed its rule when it was posted');
 const forged=structuredClone(run);forged.items[0].readiness.blocked=false;assert.equal(validRunQuality(forged),false,'The recorded block cannot be removed');
 const equipment=await s.create('Blocked meter','equipment',instrument({policy:policy({run:'block'})}));
 await assert.rejects(s.analyse('D-02',[{kind:'movement',id:use.id,revision:use.revision},{kind:'equipment',id:equipment,revision:(await s.get(equipment)).revision}]),{code:'RESOURCE_QUALITY_BLOCK'},'Equipment starting the run still meets its rule');
 const blockedEquipment=structuredClone(run);blockedEquipment.items[0]={kind:'equipment',id:equipment,revision:1,readiness:{...structuredClone(run.items[0].readiness),resourceId:equipment,resourceRevision:1,quality:instrument({policy:policy({run:'block'})}),issues:['calibration-missing']}};
 assert.equal(validRunQuality(blockedEquipment),false,'A blocked equipment snapshot is never a valid run');
});
