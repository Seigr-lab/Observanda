import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchRecords} from '../src/research.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
// A current catalogue saved through the product, in record batches of 40, across two lab books.
export async function largeCatalogueFixture(directory,{count=60,size=2000}={}){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],first=book.notebooks[0];
 book.entries=[];book.notebooks=[first,{...structuredClone(first),id:randomUUID(),title:'Other observations'}];
 const f=await encryptedFixture(directory,book),service=new ResearchRecords(f.workspace,{}),records=[];
 for(let offset=0;offset<count;offset+=40){
  const entries=Array.from({length:Math.min(40,count-offset)},(_,at)=>({...structuredClone(seed),id:randomUUID(),notebookId:book.notebooks[(offset+at)%2].id,title:'Observation '+String(offset+at).padStart(4,'0'),body:'Exact source '+(offset+at)+' '+'.'.repeat(size),share:false,sections:[],attachments:[],figures:[],relations:[]}));
  records.push(...entries);
  await service.save({workspaceId:book.id,changes:entries.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
 }
 const etag=(await f.workspace.outline()).etag;
 return {...f,book,records,etag,service};
}
