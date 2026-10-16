import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
const root='.observanda/materials/index';
async function fixture(t,count=1){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-material-audit-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book,heads=[];
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(async()=>{for(let i=0;i<count;i++)heads.push(await materials.commit({kind:'collection',recordId:book.entries[i%2].id,title:'Synthetic material '+i,content:{inputs:[]}}));});
 return {...f,materials,book,heads};
}
const verify=f=>f.materials.index.verify({initialize:false});
const replace=(f,file,value)=>f.workspace.withLock(()=>value===null?f.workspace.removeMetadata(file):f.workspace.writeMetadata(file,value));
async function pointer(f,head){
 const item=JSON.parse(await f.workspace.readMetadata(root+'/items/'+head.id+'.json',8192)),feed=f.materials.index.feed(item.recordId,item.kind),file=feed.order+'/'+feed.key(item);
 return {item,feed,file,text:await f.workspace.readMetadata(file,8192)};
}

test('material verification reads each owner once while checking every discovery pointer',async t=>{
 const f=await fixture(t,24),pending=await f.materials.startImport({recordId:f.book.entries[0].id,name:'pending.bin',size:1});
 let items=0,heads=0,markers=0;
 const read=f.workspace.readMetadata.bind(f.workspace),current=f.materials.current.bind(f.materials);
 t.mock.method(f.workspace,'readMetadata',async(file,...args)=>{if(file.startsWith(root+'/items/'))items++;if(file.endsWith('-order.json'))markers++;return read(file,...args);});
 t.mock.method(f.materials,'current',async(...args)=>{heads++;return current(...args);});
 await verify(f);
 assert.equal(items,24);assert.equal(heads,24);assert.equal(markers,7);
 t.diagnostic(JSON.stringify({materials:24,ownerReads:items,currentHeadReads:heads,feedMarkerReads:markers}));
 assert.equal((await f.materials.importState(pending.id)).completed,null);
});

test('material verification rejects missing, changed and unexpected pointers without trusting previous audits',async t=>{
 const f=await fixture(t),p=await pointer(f,f.heads[0]);await verify(f);
 await replace(f,p.file,null);await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,p.file,p.text);
 await replace(f,p.file,JSON.stringify({id:randomUUID(),createdAt:p.item.createdAt}));await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,p.file,p.text);
 const itemFile=root+'/items/'+p.item.id+'.json',itemText=await f.workspace.readMetadata(itemFile,8192);
 await replace(f,itemFile,JSON.stringify({...p.item,recordId:f.book.entries[1].id}));await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,itemFile,itemText);
 await replace(f,p.feed.marker,JSON.stringify({version:2}));await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,p.feed.marker,JSON.stringify({version:1}));
 for(const file of [root+'/heads/'+randomUUID()+'/collection-order/'+p.feed.key(p.item),root+'/heads/all/unknown-order/'+p.feed.key(p.item),p.feed.order+'/'+p.feed.key({...p.item,id:randomUUID()})]){
  await replace(f,file,p.text);await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,file,null);
 }
 await verify(f);
 // A new audit must authenticate the stored payload again.
 const objectId='metadata:'+p.file;let original;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{original=(await store.db.get('SELECT payload FROM objects WHERE id=$1',objectId)).payload;const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;await store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',corrupt,objectId);}));
 await assert.rejects(verify(f),{code:'ENCRYPTION_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',original,objectId)));
 await verify(f);
});

test('pending import verification rejects an omitted pointer and a stale pointer after completion',async t=>{
 const f=await fixture(t),pending=await f.materials.startImport({recordId:f.book.entries[0].id,name:'one-byte.bin',size:1}),feed=f.materials.index.feed(pending.recordId,null,true),file=feed.order+'/'+feed.key(pending),text=await f.workspace.readMetadata(file,8192);
 await verify(f);await replace(f,file,null);await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,file,text);
 await f.materials.appendImport(pending.id,0,[Buffer.from([7])]);await f.materials.finishImport(pending.id);await verify(f);
 await replace(f,file,text);await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});await replace(f,file,null);await verify(f);
});
