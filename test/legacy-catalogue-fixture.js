import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchRecords} from '../src/research.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
export async function legacyCatalogueFixture(directory,{count=60,size=2000,kind='flat',missingOwners=false}={}){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],first=book.notebooks[0];
 book.entries=[];book.notebooks=[first,{...structuredClone(first),id:randomUUID(),title:'Other observations'}];
 const f=await encryptedFixture(directory,book),service=new ResearchRecords(f.workspace,{}),records=[];
 for(let offset=0;offset<count;offset+=40){
  const entries=Array.from({length:Math.min(40,count-offset)},(_,at)=>({...structuredClone(seed),id:randomUUID(),notebookId:book.notebooks[(offset+at)%2].id,title:'Observation '+String(offset+at).padStart(4,'0'),body:'Exact source '+(offset+at)+' '+'.'.repeat(size),share:false,sections:[],attachments:[],figures:[],relations:[]}));
  records.push(...entries);
  await service.save({workspaceId:book.id,changes:entries.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
 }
 const etag=(await f.workspace.outline()).etag;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const original=await store.snapshot(etag),manifest=await store.manifest(etag);
  if(missingOwners)manifest.records=manifest.records.map((row,i)=>{if(i%2===0)return row;const {notebookId,queryRevision,summaryRevision,...older}=row;return older;});
  const value=kind==='flat'?manifest:{indexVersion:1,metadata:manifest.metadata,membership:await new SnapshotIndex(store).build(manifest.records.map((row,position)=>({...row,position}))),count:count,bytes:original.bytes,nextPosition:count};
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',etag,value),etag);
 }));
 return {...f,book,records,etag,service};
}
