import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace,digest,serialize} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ObjectIndex} from '../src/object-index.js';
const hash=v=>digest(serialize(v));
const key=n=>'metadata:.observanda/materials/records/'+String(n).padStart(5,'0')+'/manifest.json';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-object-index-'));
 const {workspace:ws,vault}=await encryptedFixture(directory,upgradeNotebook(sampleNotebook()));
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,ws,vault};
}
const write=(ws,fn)=>ws.withLock(()=>ws.catalogue(fn));
const snapshot=ws=>ws.catalogue(s=>s.db.all("SELECT slot,payload FROM state WHERE slot='objects' OR starts_with(slot,'object-index:') ORDER BY slot"));
const values=ws=>ws.catalogue(async s=>new Map((await Array.fromAsync(s.verifiedObjects())).map(e=>[e.id,e.value])));

test('immutable differences recheck an unchanged subtree placed outside its previous ordering bounds',async t=>{
 const {ws}=await fixture(t);
 await ws.catalogue(async store=>{
  const index=new ObjectIndex(store,{namespace:'qualification:',immutable:true}),revision='0'.repeat(64);
  // Both roots have valid hashes, heights and cardinalities. The second root
  // places the exact old child beyond its new parent's upper bound.
  const child=index.make('m',revision),before=index.make('z',revision,child),after=index.make('a',revision,child);
  await assert.rejects(Array.fromAsync(index.differences(before,after)),{code:'CATALOGUE_DAMAGED'});
 });
});

test('cached node authentication cannot be changed or reused for a different root hash',async t=>{
 const {ws}=await fixture(t);await write(ws,async store=>{for(let i=0;i<5;i++)await store.putObject(key(i),{value:i});});
 await ws.catalogue(async store=>{
  const index=new ObjectIndex(store,{cacheReads:true}),head=await index.head(),node=await index.node(head.root);
  assert.ok(Object.isFrozen(node));assert.ok(Object.isFrozen(node.left));
  assert.throws(()=>{node.revision='0'.repeat(64);},TypeError);
  assert.throws(()=>{node.left.count++;},TypeError);
  assert.equal(await index.node(head.root),node);
  await assert.rejects(index.node({...head.root,hash:'0'.repeat(64)}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(index.node({...head.root,extra:{mutable:true}}),{code:'CATALOGUE_DAMAGED'});
  const malformed={...node,extra:{mutable:true}},ref={...head.root,hash:hash(malformed)},other=new ObjectIndex(store,{immutable:true});
  other.pending.set(ref.hash,malformed);await assert.rejects(other.node(ref),{code:'CATALOGUE_DAMAGED'});
 });
});

test('point edits and small prefix listings stay bounded as evidence metadata grows',async t=>{
 const {ws}=await fixture(t),expected=new Map();
 await write(ws,async s=>{
  for(let n=0;n<512;n++){const v={label:'Private capture '+n,bytes:'67108864'};expected.set(key(n),v);await s.putObject(key(n),v);}
  for(let n=0;n<3;n++){const id='metadata:.observanda/drafts/'+n+'.json';expected.set(id,{text:'Creative take '+n});await s.putObject(id,expected.get(id));}
 });
 assert.deepEqual(await values(ws),new Map([...expected].sort(([a],[b])=>a<b?-1:1)));
 const before=await snapshot(ws);let reads=0,writes=0,objectReads=0;
 await write(ws,async s=>{
  const decode=s.decode.bind(s),run=s.db.run.bind(s.db);
  s.decode=(table,id,bytes)=>{if(table==='state'&&(id==='objects'||id.startsWith('object-index:')))reads++;if(table==='object')objectReads++;return decode(table,id,bytes);};
  s.db.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO state'))writes++;return run(sql,...args);};
  await s.putObject(key(250),{label:'Revised capture',bytes:'67108864'});
 });
 assert.ok(reads<40,'single save must not decrypt the whole metadata index');assert.equal(objectReads,1);assert.ok(writes<24);
 const after=await snapshot(ws),prior=new Map(before.map(r=>[r.slot,r.payload]));
 assert.equal(after.length,516);assert.ok(after.filter(r=>!r.payload.equals(prior.get(r.slot))).length<24);
 assert.ok(after.every(r=>r.payload.length<2048),'index rows remain small');
 reads=0;
 await ws.catalogue(async s=>{const decode=s.decode.bind(s);s.decode=(table,id,bytes)=>{if(table==='state')reads++;return decode(table,id,bytes);};assert.deepEqual(await s.objectIds('metadata:.observanda/drafts/'),[0,1,2].map(n=>'metadata:.observanda/drafts/'+n+'.json'));});
 assert.ok(reads<24,'listing three drafts must not decrypt unrelated evidence metadata');
 await write(ws,s=>s.putObject(key(250),{label:'Revised capture',bytes:'67108864'}));assert.deepEqual(await snapshot(ws),after,'unchanged writes retain existing ciphertext');
});

test('mixed insertion, replacement and deletion retain every object without abandoned index rows',async t=>{
 const {ws}=await fixture(t),expected=new Map();let seed=7;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let batch=0;batch<8;batch++){
  await write(ws,async s=>{for(let i=0;i<80;i++){const id=key(random()%129);if(random()%3===0){expected.delete(id);await s.deleteObject(id);}else{const v={sequence:batch*80+i,exact:'18446744073709551617'};expected.set(id,v);await s.putObject(id,v);}}});
  assert.deepEqual(await values(ws),new Map([...expected].sort(([a],[b])=>a<b?-1:1)));
 }
 await write(ws,async s=>{for(const id of [...expected.keys()].reverse())await s.deleteObject(id);});
 assert.equal((await values(ws)).size,0);assert.equal((await snapshot(ws)).length,1);
 await write(ws,s=>s.putObject(key(900),{retained:true}));assert.deepEqual(await ws.catalogue(s=>s.object(key(900))),{retained:true});
});

test('a failed index update rolls back before retry; repeatable readers keep one coherent revision',async t=>{
 const {ws}=await fixture(t);await write(ws,async s=>{for(let i=0;i<31;i++)await s.putObject(key(i),{take:i});});
 const before=await snapshot(ws);
 await assert.rejects(write(ws,async s=>{const run=s.db.run.bind(s.db);s.db.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO objects'))throw Error('Interrupted before object commit');return run(sql,...args);};await s.putObject(key(12),{take:'incomplete'});}),/Interrupted before object commit/);
 assert.deepEqual(await snapshot(ws),before);assert.deepEqual(await ws.catalogue(s=>s.object(key(12))),{take:12});
 // A second connection commits an edit, insertion and removal during the read.
 await ws.catalogue(async reader=>{
  assert.deepEqual(await reader.object(key(12)),{take:12});
  await write(new Workspace(ws.root,ws.vault),async s=>{await s.putObject(key(12),{take:'revised'});await s.putObject(key(31),{take:31});await s.deleteObject(key(0));});
  assert.deepEqual(await reader.object(key(12)),{take:12});assert.deepEqual(await reader.object(key(0)),{take:0});assert.equal(await reader.object(key(31)),null);assert.equal((await Array.fromAsync(reader.verifiedObjects())).length,31);
 });
 assert.deepEqual(await ws.catalogue(s=>s.object(key(12))),{take:'revised'});assert.equal(await ws.catalogue(s=>s.object(key(0))),null);
 assert.deepEqual(await ws.catalogue(s=>s.object(key(31))),{take:31});
});

test('missing, replayed and swapped metadata cannot be hidden by reads, saves or backup verification',async t=>{
 const {ws,directory,vault}=await fixture(t);
 await write(ws,async s=>{for(let i=0;i<7;i++)await s.putObject(key(i),{private:'Original '+i});});
 const db=await ws.openCatalogue();t.after(()=>db.close());
 const oldObject=await db.get('SELECT payload FROM objects WHERE id=$1',key(3)),oldNodes=await snapshot(ws);
 await write(ws,s=>s.putObject(key(3),{private:'Revised'}));
 const head=await ws.catalogue(s=>new ObjectIndex(s).head()),rootSlot='object-index:'+head.root.key;
 const root=await db.get('SELECT payload FROM state WHERE slot=$1',rootSlot),object=await db.get('SELECT payload FROM objects WHERE id=$1',key(3));
 const check=()=>assert.rejects(ws.catalogue(s=>s.object(key(3))),e=>['CATALOGUE_DAMAGED','ENCRYPTION_DAMAGED'].includes(e.code));
 await db.run('DELETE FROM state WHERE slot=$1',rootSlot);
 try{
  await check();await assert.rejects(ws.catalogue(s=>s.objectIds('metadata:')),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(write(ws,s=>s.putObject(key(3),{private:'Must not repair missing index'})),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(copyWorkspace(await copyPlan(ws.root,path.join(directory,'damaged-backup')),{vault}),{code:'CATALOGUE_DAMAGED'});
 }finally{await db.run('INSERT INTO state VALUES ($1,$2)',rootSlot,root.payload);}
 await db.run('UPDATE state SET payload=$2 WHERE slot=$1',rootSlot,oldNodes.find(r=>r.slot===rootSlot).payload);
 try{await check();}finally{await db.run('UPDATE state SET payload=$2 WHERE slot=$1',rootSlot,root.payload);}
 await db.run('UPDATE objects SET payload=$2 WHERE id=$1',key(3),oldObject.payload);
 try{await check();await assert.rejects(write(ws,s=>s.putObject(key(3),{private:'Must not heal replay'})),{code:'CATALOGUE_DAMAGED'});}finally{await db.run('UPDATE objects SET payload=$2 WHERE id=$1',key(3),object.payload);}
 const other=await db.get('SELECT payload FROM objects WHERE id=$1',key(4));await db.run('UPDATE objects SET payload=$2 WHERE id=$1',key(3),other.payload);
 try{await check();}finally{await db.run('UPDATE objects SET payload=$2 WHERE id=$1',key(3),object.payload);}
 await db.run('DELETE FROM objects WHERE id=$1',key(3));
 try{await check();await assert.rejects(ws.catalogue(s=>s.objectIds('metadata:')),{code:'CATALOGUE_DAMAGED'});}finally{await db.run('INSERT INTO objects VALUES ($1,$2)',key(3),object.payload);}
 await db.run('INSERT INTO state VALUES ($1,$2)','object-index:unexpected',root.payload);
 try{await assert.rejects(values(ws),{code:'CATALOGUE_DAMAGED'});}finally{await db.run('DELETE FROM state WHERE slot=$1','object-index:unexpected');}
 assert.equal((await values(ws)).size,7);
});

test('ordinary and fresh-key backups retain objects and can edit their indexes independently',async t=>{
 const {ws,directory,vault}=await fixture(t),expected=new Map();
 await write(ws,async s=>{for(let i=0;i<40;i++){expected.set(key(i),{capture:i,exact:'18446744073709551617',base:6,digits:'555555'});await s.putObject(key(i),expected.get(key(i)));}});
 const before=await snapshot(ws),backup=await copyWorkspace(await copyPlan(ws.root,path.join(directory,'backup')),{vault});
 const access=await createAccess('','synthetic fresh key'),nextVault=takeCreatedVault(access);t.after(()=>clearVault(nextVault));
 const rekeyed=await encryptedCopy(await copyPlan(ws.root,path.join(directory,'rekeyed')),access,nextVault,vault);
 for(const target of [new Workspace(backup,vault),new Workspace(rekeyed,nextVault)]){
  assert.deepEqual(await values(target),expected);
  await write(target,async s=>{await s.deleteObject(key(8));await s.putObject(key(9),{capture:'New interpretation'});});
  assert.equal((await values(target)).size,39);assert.deepEqual(await target.catalogue(s=>s.object(key(9))),{capture:'New interpretation'});
 }
 assert.deepEqual(await snapshot(ws),before);assert.deepEqual(await values(ws),expected);
});

test('flat indexes update in place atomically while unknown index versions fail closed',async t=>{
 const {ws}=await fixture(t),expected=new Map([[key(1),{take:'first'}],[key(2),{take:'second'}]]);
 await write(ws,async s=>{
  for(const [id,value] of expected)await s.putObject(id,value);
  await s.db.run("DELETE FROM state WHERE starts_with(slot,'object-index:')");
  await s.db.run("UPDATE state SET payload=$1 WHERE slot='objects'",s.encode('state','objects',{entries:[...expected].map(([id,value])=>({id,revision:hash(value)}))}));
 });
 const before=await snapshot(ws);assert.deepEqual(await values(ws),expected);
 await assert.rejects(write(ws,async s=>{await s.putObject(key(3),{take:'interrupted'});throw Error('Interrupted upgrade');}),/Interrupted upgrade/);
 assert.deepEqual(await snapshot(ws),before);
 await write(ws,s=>s.putObject(key(3),{take:'third'}));expected.set(key(3),{take:'third'});
 assert.deepEqual(await values(ws),expected);assert.equal((await ws.catalogue(s=>new ObjectIndex(s).head())).formatVersion,2);
 await write(ws,s=>s.db.run("UPDATE state SET payload=$1 WHERE slot='objects'",s.encode('state','objects',{formatVersion:999,root:null})));
 await assert.rejects(ws.catalogue(s=>s.object(key(1))),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(write(ws,s=>s.putObject(key(1),{})),{code:'CATALOGUE_DAMAGED'});
});

test('replaying an earlier empty index cannot make existing objects disappear or authorize a replacement root',async t=>{
 const {ws}=await fixture(t);
 await write(ws,async s=>{await s.putObject(key(1),{take:1});await s.deleteObject(key(1));});
 const empty=(await snapshot(ws)).find(r=>r.slot==='objects');
 await write(ws,s=>s.putObject(key(2),{take:2}));const before=await snapshot(ws),head=before.find(r=>r.slot==='objects');
 const db=await ws.openCatalogue();
 try{
  await db.run("UPDATE state SET payload=$1 WHERE slot='objects'",empty.payload);
  await assert.rejects(ws.catalogue(s=>s.object('new unrelated key')),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(write(ws,s=>s.putObject(key(3),{take:3})),{code:'CATALOGUE_DAMAGED'});
  assert.equal(await db.get('SELECT 1 FROM objects WHERE id=$1',key(3)),undefined);
 }finally{await db.run("UPDATE state SET payload=$1 WHERE slot='objects'",head.payload);await db.close();}
 assert.deepEqual(await snapshot(ws),before);assert.deepEqual(await ws.catalogue(s=>s.object(key(2))),{take:2});
});

test('authenticated range pages read only their branch and selected values, including a late cursor',async t=>{
 const {ws}=await fixture(t);
 await write(ws,async s=>{for(let i=0;i<257;i++)await s.putObject(key(i),{take:i});});
 let cursor=null,seen=[];
 do{
  let nodes=0,objects=0;
  const page=await ws.catalogue(async s=>{
   const decode=s.decode.bind(s);s.decode=(table,id,payload)=>{if(table==='state')nodes++;if(table==='object')objects++;return decode(table,id,payload);};
   s.db.all=()=>{throw Error('A bounded page must not scan all object IDs');};
   return s.objectPage('metadata:.observanda/materials/records/',{after:cursor,limit:13});
  });
  assert.ok(nodes<40,'late pages must seek through the tree');assert.equal(objects,page.items.length);seen.push(...page.items.map(r=>r.value.take));cursor=page.next;
 }while(cursor);
 assert.deepEqual(seen,Array.from({length:257},(_,i)=>i));
 await assert.rejects(ws.catalogue(s=>s.objectPage('metadata:',{limit:101})),{code:'INVALID'});
 await assert.rejects(ws.catalogue(s=>s.objectPage('metadata:',{after:'unrelated'})),{code:'INVALID'});
 const db=await ws.openCatalogue();try{
  const row=await db.get('SELECT payload FROM objects WHERE id=$1',key(250));await db.run('DELETE FROM objects WHERE id=$1',key(250));
  await assert.rejects(ws.catalogue(s=>s.objectPage('metadata:.observanda/materials/records/',{after:key(249),limit:5})),{code:'CATALOGUE_DAMAGED'});
  await db.run('INSERT INTO objects VALUES ($1,$2)',key(250),row.payload);
 }finally{await db.close();}
});
test('comparing moved shared branches checks their extrema without walking all unchanged nodes',async()=>{
 const index=new ObjectIndex({},{immutable:true}),revision='1'.repeat(64);
 const branch=(prefix,start,end)=>{if(start===end)return null;const mid=Math.floor((start+end)/2);return index.make(prefix+String(mid).padStart(4,'0'),revision,branch(prefix,start,mid),branch(prefix,mid+1,end));};
 const left=branch('A',0,1023),right=branch('Z',0,1023),before=index.make('M',revision,left,right),after=index.make('N',revision,left,right);
 const node=index.node;let reads=0;index.node=function(...args){reads++;return node.apply(this,args);};
 const changes=await Array.fromAsync(index.differences(before,after));
 assert.deepEqual(changes.map(change=>[change.id,!!change.before,!!change.after]),[['M',true,false],['N',false,true]]);
 assert.ok(reads<80,'Shared branches must require only bounded extreme-path reads: '+reads);
});

test('moved shared branches cannot hide a descendant outside a tightened parent bound',async()=>{
 const index=new ObjectIndex({},{immutable:true}),revision='2'.repeat(64),leaf=id=>index.make(id,revision,null,null);
 const left=index.make('C',revision,leaf('A'),leaf('G')),right=leaf('I');
 await assert.rejects(Array.fromAsync(index.differences(index.make('H',revision,left,right),index.make('E',revision,left,right))),{code:'CATALOGUE_DAMAGED'});
 const high=index.make('M',revision,leaf('K'),leaf('O')),low=leaf('I');
 await assert.rejects(Array.fromAsync(index.differences(index.make('J',revision,low,high),index.make('L',revision,low,high))),{code:'CATALOGUE_DAMAGED'});
});

test('small insertions and removals compare only changed branches across rotations',async()=>{
 const index=new ObjectIndex({},{immutable:true}),revision='3'.repeat(64),key=n=>String(n).padStart(5,'0');
 const branch=(start,end)=>{if(start===end)return null;const mid=Math.floor((start+end)/2);return index.make(key(mid*2),revision,branch(start,mid),branch(mid+1,end));};
 const before=branch(0,2047);
 for(const changes of [[[2046,null]],[[1,revision],[3,revision],[5,revision]],Array.from({length:10},(_,i)=>[i*380+1,revision])]){
  let after=before;for(const [id,value] of changes)after=await index.change(after,key(id),value);
  const node=index.node;let reads=0;index.node=function(...args){reads++;return node.apply(this,args);};
  let actual;try{actual=await Array.fromAsync(index.differences(before,after));}finally{index.node=node;}
  assert.deepEqual(actual.map(change=>change.id),changes.map(([id])=>key(id)).sort());
  assert.ok(reads<600,'Small edits must not walk all retained nodes: '+reads);
 }
});
