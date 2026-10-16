import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {access,mkdir} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {InventoryOperationStore} from '../src/inventory-operation-store.js';
import {assertInventoryObligationsSettled} from '../src/inventory-obligation-lifecycle.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {copyProjectOwnerLocation,projectTransferReceipt} from '../src/project-transfer.js';

test('pending and live external stock obligations block copies before creating destination data',{timeout:90000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['bom','inventory']);await assertInventoryObligationsSettled(f.storage);
 for(const domain of ['bom','inventory'])for(const kind of ['pending','live']){
  const id=randomUUID();await f.domains.run([domain],get=>new InventoryOperationStore(get(domain)).write(kind,id,{version:1,id}),{write:[domain]});
  try{
   await assert.rejects(assertInventoryObligationsSettled(f.storage),{code:'INVENTORY_OBLIGATIONS'});
   const parent=path.join(f.root,domain+'-'+kind);await mkdir(parent);const destination=path.join(parent,path.basename(f.storage.root));
   await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id:randomUUID()}),{code:'INVENTORY_OBLIGATIONS'});await assert.rejects(access(destination),{code:'ENOENT'});
  }finally{await f.domains.run([domain],get=>new InventoryOperationStore(get(domain)).remove(kind,id),{write:[domain]});}
  await assertInventoryObligationsSettled(f.storage);
 }
 // A new obligation after the preflight is caught inside the source handoff.
 const handoff=f.storage.withStorageHandoff.bind(f.storage),id=randomUUID(),destination=path.join(f.root,'race','project');await mkdir(path.dirname(destination));
 f.storage.withStorageHandoff=async(fn,options)=>{await f.domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).write('live',id,{version:1,id}),{write:['inventory']});return handoff(fn,options);};
 try{await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id:randomUUID()}),{code:'INVENTORY_OBLIGATIONS'});}finally{f.storage.withStorageHandoff=handoff;await f.domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).remove('live',id),{write:['inventory']});}
 assert.equal(await catalogueBinding(destination),null);await assertInventoryObligationsSettled(f.storage);
});

test('copy receipts bind new transfer modes while older paused transfers retain recovery compatibility',{timeout:90000},async t=>{
 const f=await fixture(t),id=randomUUID(),destination=path.join(f.root,'mode-copy','project');await mkdir(path.dirname(destination));
 const target=await copyProjectOwnerLocation(f.storage,destination,{id});
 try{
  const receipt=await projectTransferReceipt(target);assert.equal(receipt.relocation,false);
  await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id,relocation:true}),{code:'CONFLICT'});
  const legacy={...receipt};delete legacy.relocation;
  const file=path.join(target.root,'.observanda/project-transfer.observanda');await target.writeFile(file,JSON.stringify(legacy));
  assert.equal((await copyProjectOwnerLocation(f.storage,destination,{id,relocation:true})).root,destination);
  await target.writeFile(file,JSON.stringify({...receipt,relocation:'move'}));
  await assert.rejects(copyProjectOwnerLocation(f.storage,destination,{id}),{code:'STORAGE_COPY'});
 }finally{await f.runtime.closeProject(destination);}
});
