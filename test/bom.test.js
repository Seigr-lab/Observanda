import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ModuleDrafts} from '../src/modules/drafts.js';
import {buildPublication} from '../src/publication.js';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {workspaceModules} from '../src/modules/index.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {recordRevision} from '../src/research.js';
import {assertPrivateCatalogue} from './postgres-fixture.js';
import {blankBOM,bomLine,bomAvailability,requiredQuantity} from '../src/web/modules/bom-model.js';
import {balance,multiply} from '../src/web/modules/quantities.js';
import {inventoryQuantity} from '../src/web/modules/inventory-model.js';
import {enabledLabBookTypes} from '../src/web/feature-modules.js';
import {defaultDashboard} from '../src/web/dashboard-model.js';

async function setup(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bom-')),book=upgradeNotebook(sampleNotebook());
 book.title='Synthetic prototypes';book.entries[0].title='PRIVATE board build';book.entries[0].share=false;
 const f=await encryptedFixture(directory,book),store=workspaceModules(f.workspace),project=book.projects[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const cmd=(action,payload,commandId=randomUUID())=>store.execute({workspaceId:book.id,commandId,action,payload});
 const get=async id=>(await store.read()).entities.find(e=>e.id===id);
 const item=async(name,quantity='100',unit='items')=>{
  const id=randomUUID();await cmd('resource.create',{id,data:{projectId:null,placementId:null,name,code:id,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'PRIVATE drawer path',unit,capacity:1,status:'available',links:[]},openingStock:{quantity,projectId:null}});return id;
 };
 const save=async(lines,extra={})=>{const id=randomUUID();await cmd('bom.save',{id,expectedRevision:null,data:{...blankBOM(),title:'PRIVATE BOM',recordId:book.entries[0].id,designRevision:'board A / PRIVATE source',lines,...extra}});return id;};
 const line=(resourceId,extra={})=>({...bomLine(),resourceId,value:'4k7 resistor',...extra});
 const reserve=async id=>{const b=await get(id),ids=[...new Set(b.data.lines.filter(l=>!l.dnp).map(l=>l.resourceId))];return cmd('bom.reserve',{id,expectedRevision:b.revision,resources:await Promise.all(ids.map(async id=>({id,revision:(await get(id)).revision})))});};
 return {...f,directory,book,store,project,cmd,get,item,line,save,reserve};
}
test('optional physical and audio types stay disabled by default; quantities retain exact decimal values',()=>{
 const settings=defaultDashboard();
 assert.ok(!enabledLabBookTypes(settings).some(p=>['physical-prototyping','audio-software'].includes(p.id)));
 settings.enabledModules.push('laboratory-physical-prototyping','laboratory-audio-software');
 assert.ok(enabledLabBookTypes(settings).some(p=>p.id==='physical-prototyping'));
 assert.ok(enabledLabBookTypes(settings).some(p=>p.id==='audio-software'));
 assert.equal(multiply('9007199254740993','3'),'27021597764222979');
 assert.equal(multiply('0.000000000000000001','3'),'0.000000000000000003');
 assert.throws(()=>multiply('9999999999999999999999999999999999999999','999999'));
 assert.equal(requiredQuantity({buildCount:'5'},{quantity:'9',dnp:true}),'0');
});
test('one BOM reserves distinct stock sources, records partial use and scrap, retains exact run identity and survives encrypted backup',async t=>{
 const s=await setup(t),resistor=await s.item('PRIVATE resistor'),opamp=await s.item('PRIVATE opamp','20');
 await s.cmd('stock.transfer',{resourceId:resistor,expectedRevision:(await s.get(resistor)).revision,fromProjectId:null,toProjectId:s.project,quantity:'40',reason:'Allocate bench stock',links:[]});
 const a=s.line(resistor,{references:'R1, R2',quantity:'2',sourceProjectId:s.project}),b=s.line(opamp,{references:'U1',value:'TL072',quantity:'1'}),dnp=s.line(null,{references:'C99',value:'Unfitted option',dnp:true});
 const id=await s.save([a,b,dnp],{buildCount:'2'}),recordBefore=(await s.workspace.read()).book.entries[0];
 assert.equal((await s.get(id)).data.recordRevision,recordRevision(recordBefore));
 assert.equal(balance((await s.store.read()).entities,resistor).reserved,'0');
 await s.reserve(id);let entities=(await s.store.read()).entities;
 assert.deepEqual(balance(entities,resistor),{physical:'100',reserved:'4',available:'96'});
 assert.deepEqual(inventoryQuantity(s.book,entities,resistor,s.project),{physical:'40',reserved:'4',available:'36'});
 assert.equal(inventoryQuantity(s.book,entities,resistor,null,false).physical,'60');
 assert.equal(entities.filter(e=>e.type==='reservation').length,2,'DNP never reserves');
 const reserved=await s.get(id),reservation=await s.get(reserved.data.allocations[0].reservationId);
 await assert.rejects(s.cmd('stock.resolve',{id:reservation.id,expectedRevision:reservation.revision,decision:'consume'}),{code:'MODULE_INVALID'});
 const commandId=randomUUID(),payload={id,expectedRevision:reserved.revision,usage:[{lineId:a.id,used:'2',scrapped:'1'},{lineId:b.id,used:'1',scrapped:'0'}]};
 await s.cmd('bom.finish',payload,commandId);const finished=await s.store.read();await s.cmd('bom.finish',payload,commandId);
 assert.deepEqual(await s.store.read(),finished,'Lost reply retry does not double consume');
 entities=finished.entities;
 assert.deepEqual(balance(entities,resistor),{physical:'97',reserved:'0',available:'97'});
 assert.equal(inventoryQuantity(s.book,entities,resistor,s.project).physical,'37');
 assert.equal(balance(entities,opamp).physical,'19');
 assert.equal((await s.get(id)).data.status,'finished');assert.equal((await s.get(reservation.id)).data.status,'settled');
 assert.deepEqual((await s.workspace.read()).book.entries[0],recordBefore,'Inventory use never asserts execution or success');
 await assertPrivateCatalogue(s.workspace.root,'PRIVATE resistor','PRIVATE BOM','PRIVATE drawer path');
 const edition=buildPublication((await s.workspace.read()).book);
 for(const [name,bytes] of edition.files)for(const privateText of ['PRIVATE BOM','PRIVATE resistor','PRIVATE drawer path','PRIVATE board build','PRIVATE source'])assert.ok(!String(name).includes(privateText)&&!String(bytes).includes(privateText));
 const copy=await copyWorkspace(await copyPlan(s.workspace.root,path.join(s.directory,'backup')),{vault:s.vault});
 assert.deepEqual(await workspaceModules(new Workspace(copy,s.vault)).read(),finished);
 const invalid=structuredClone(finished);invalid.entities.find(e=>e.type==='movement'&&e.data.reservationId).data.delta='-1.5';
 assert.throws(()=>s.store.validate(invalid),{code:'MODULE_INVALID'});
});
test('repeated item requirements aggregate, failed reservations roll back all lines and competing plans cannot overdraw stock',async t=>{
 const s=await setup(t),part=await s.item('Capacitor','5'),a=s.line(part,{references:'C1',quantity:'3'}),b=s.line(part,{references:'C2',quantity:'3'}),id=await s.save([a,b]);
 const before=await s.store.read(),preview=bomAvailability((await s.get(id)).data,before.entities);
 assert.equal(preview.length,1);assert.equal(preview[0].quantity,'6');assert.equal(preview[0].shortage,'1');
 await assert.rejects(s.reserve(id),{code:'STOCK_UNAVAILABLE'});assert.deepEqual(await s.store.read(),before);
 const first=await s.save([s.line(part,{quantity:'4'})]),second=await s.save([s.line(part,{quantity:'4'})]);
 const head=(await s.get(part)).revision,request=async id=>({id,expectedRevision:(await s.get(id)).revision,resources:[{id:part,revision:head}]});
 const p=await request(first),q=await request(second);
 await s.cmd('bom.reserve',p);await assert.rejects(s.cmd('bom.reserve',q),{code:'MODULE_CHANGED'});
 assert.equal(balance((await s.store.read()).entities,part).available,'1');
 await s.cmd('bom.cancel',{id:first,expectedRevision:(await s.get(first)).revision});
 assert.deepEqual(balance((await s.store.read()).entities,part),{physical:'5',reserved:'0',available:'5'});
 await s.reserve(second);
 assert.equal(balance((await s.store.read()).entities,part).available,'1');
});
test('changed records require explicit review before reservation; frozen plans and cancelled runs keep their pinned references',async t=>{
 const s=await setup(t),part=await s.item('Wire','1.5','m'),line=s.line(part,{quantity:'0.2',unit:'m'}),id=await s.save([line],{buildCount:'3'}),original=await s.get(id);
 let workspace=await s.workspace.read();workspace.book.entries[0].title='Amended method and build';await s.workspace.save(workspace.book,workspace.etag);
 await assert.rejects(s.reserve(id),{code:'MODULE_INVALID'});
 await s.cmd('bom.save',{id,expectedRevision:original.revision,data:original.data});await s.reserve(id);
 const reserved=await s.get(id);assert.notEqual(reserved.data.recordRevision,original.data.recordRevision);
 workspace=await s.workspace.read();workspace.book.entries[0].title='Later interpretation';await s.workspace.save(workspace.book,workspace.etag);
 await assert.rejects(s.cmd('bom.save',{id,expectedRevision:reserved.revision,data:{...reserved.data,status:'draft',allocations:[]}}),{code:'MODULE_INVALID'});
 const before=await s.store.read();
 await assert.rejects(s.cmd('bom.finish',{id,expectedRevision:reserved.revision,usage:[{lineId:line.id,used:'0.5',scrapped:'0.2'}]}),{code:'MODULE_INVALID'});
 assert.deepEqual(await s.store.read(),before);
 await s.cmd('bom.cancel',{id,expectedRevision:reserved.revision});
 assert.equal((await s.get(id)).data.recordRevision,reserved.data.recordRevision);
 assert.deepEqual(balance((await s.store.read()).entities,part),{physical:'1.5',reserved:'0',available:'1.5'});
});
test('malformed BOMs and unmapped populated lines are rejected without stock changes',async t=>{
 const s=await setup(t),part=await s.item('Part'),before=await s.store.read();
 for(const lines of [[s.line(part,{quantity:'1e3'})],[s.line(part,{quantity:'-1'})],[s.line(part,{unit:'kg'})],[s.line(part,{references:'R1'}),s.line(part,{references:'r1'})],[]]){
  await assert.rejects(s.save(lines),{code:'MODULE_INVALID'});assert.deepEqual(await s.store.read(),before);
 }
 const id=await s.save([s.line(null)]),b=await s.get(id);
 await assert.rejects(s.cmd('bom.reserve',{id,expectedRevision:b.revision,resources:[]}),{code:'MODULE_INVALID'});
 assert.equal(balance((await s.store.read()).entities,part).reserved,'0');
});

test('unfinished actual-use input checkpoints retain the original revision privately without consuming stock',async t=>{
 const s=await setup(t),part=await s.item('Draft parts'),line=s.line(part),id=await s.save([line]);await s.reserve(id);
 const entity=await s.get(id),drafts=new ModuleDrafts(s.workspace),values={expectedRevision:entity.revision,usage:[{lineId:line.id,used:'1',scrapped:'0'}]},request={workspaceId:s.book.id,moduleId:'resources',id:randomUUID(),etag:null,drafts:[{id,type:'bom',expectedRevision:entity.revision,base:entity.data,data:entity.data,operation:{kind:'bom-finish',values,base:{...values,usage:[{lineId:line.id,used:'',scrapped:'0'}]}}}]};
 const result=await drafts.write(request),read=await drafts.read(request.id);
 assert.deepEqual(read.draft.drafts,request.drafts);
 assert.equal((await drafts.list('resources')).drafts.length,1);
 assert.equal(balance((await s.store.read()).entities,part).physical,'100');
 await assertPrivateCatalogue(s.workspace.root,'Draft parts','Actually used');
 for(const invalid of [null,{...request.drafts[0],operation:null},{...request.drafts[0],operation:{kind:'bad action',values,base:{}}}])
  await assert.rejects(drafts.write({...request,etag:result.etag,drafts:[invalid]}),{code:'MODULE_INVALID'});
 assert.deepEqual((await drafts.read(request.id)).draft.drafts,request.drafts);
});

test('BOM import verifies the pinned original, preserves it through backup and permits deliberate plan edits',async t=>{
 const {ResearchMaterials}=await import('../src/research-materials.js'),{readBOMSource}=await import('../src/bom-import.js');
 const {mapBOMTable,suggestedBOMMapping}=await import('../src/web/modules/bom-import-model.js');
 const s=await setup(t),materials=new ResearchMaterials(s.workspace);
 const bytes=Buffer.from('Reference,Value,Qty,DNP,Secret\n"R1,R2",4k7,2,,PRIVATE source path\nC9,100n,1,DNP,\n');
 const session=await materials.startImport({recordId:s.book.entries[0].id,name:'PRIVATE-bom.csv',size:bytes.length,provenance:'PRIVATE workstation',derivesFrom:[]});
 await materials.appendImport(session.id,0,[bytes]);const artifact=await materials.finishImport(session.id),result=await readBOMSource(s.workspace,{artifact});
 const mapping=suggestedBOMMapping(result.table),mapped=mapBOMTable(result.table,mapping),{table,...meta}=result;
 const source={version:1,...meta,delimiter:table.delimiter,mapping,referenceSeparator:','},lines=mapped.lines.map(({row,...line})=>({...bomLine(),...line}));
 const id=await s.save(lines,{source});
 assert.deepEqual((await s.get(id)).data.source,source);
 let entity=await s.get(id);
 const openOriginal=ResearchMaterials.prototype.artifact;ResearchMaterials.prototype.artifact=()=>{throw Error('Unchanged BOM source was reprocessed');};
 try{await s.cmd('bom.save',{id,expectedRevision:entity.revision,data:{...entity.data,lines:entity.data.lines.map((l,i)=>i?l:{...l,value:'4k7 selected tolerance',notes:'Deliberate substitution reviewed'})}});}finally{ResearchMaterials.prototype.artifact=openOriginal;}
 entity=await s.get(id);assert.equal(entity.data.lines[0].notes,'Deliberate substitution reviewed');
 const before=await s.store.read();
 await assert.rejects(s.cmd('bom.save',{id,expectedRevision:entity.revision,data:{...entity.data,source:{...source,name:'forged.csv'}}}),{code:'MODULE_INVALID'});
 await assert.rejects(s.save(lines,{source:{...source,sha256:'0'.repeat(64)}}),{code:'MODULE_INVALID'});
 assert.deepEqual(await s.store.read(),before);
 const original=await materials.artifact(artifact),parts=[];for await(const p of original.content.read())parts.push(p);
 assert.deepEqual(Buffer.concat(parts),bytes);
 const backup=await copyWorkspace(await copyPlan(s.workspace.root,path.join(s.directory,'import-backup')),{vault:s.vault}),restored=new Workspace(backup,s.vault);
 assert.deepEqual((await workspaceModules(restored).read()).entities.find(e=>e.id===id),entity);
 assert.deepEqual((await readBOMSource(restored,{artifact})).table,table);
 const edition=buildPublication((await s.workspace.read()).book);
 for(const [name,content] of edition.files)assert.ok(!String(name).includes('PRIVATE-bom')&&!String(content).includes('PRIVATE source path')&&!String(content).includes(source.sha256));
 await assertPrivateCatalogue(s.workspace.root,'PRIVATE-bom.csv','PRIVATE source path');
});
test('BOM original parsing rejects invalid UTF-8 and oversized artifacts before import',async t=>{
 const {ResearchMaterials}=await import('../src/research-materials.js'),{readBOMSource}=await import('../src/bom-import.js');
 const s=await setup(t),m=new ResearchMaterials(s.workspace),bytes=Buffer.from([0xff,0xfe,0,1]),session=await m.startImport({recordId:s.book.entries[0].id,name:'invalid.csv',size:bytes.length,provenance:'',derivesFrom:[]});
 await m.appendImport(session.id,0,[bytes]);const artifact=await m.finishImport(session.id);
 await assert.rejects(readBOMSource(s.workspace,{artifact}),{code:'MODULE_INVALID'});
 await assert.rejects(readBOMSource(s.workspace,null),{code:'MODULE_INVALID'});
 const stop=new AbortController();stop.abort();await assert.rejects(readBOMSource(s.workspace,{artifact},{signal:stop.signal}),{name:'AbortError'});
 const oversized=await s.workspace.withLock(()=>m.commit({kind:'artifact',recordId:s.book.entries[0].id,title:'Oversize table',content:{name:'huge.csv',size:1024*1024+1,sha256:'0'.repeat(64)}}));
 await assert.rejects(readBOMSource(s.workspace,{artifact:oversized}),{code:'MODULE_INVALID'});
});
