import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {mediaFixtures} from './media-fixtures.js';
import {MediaStore} from '../src/media.js';
import {clearVault} from '../src/encryption.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordValues} from '../src/record-values.js';
export async function mediaValueFixture({large=false,shared=false,count=9}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-values-')),source=sampleNotebook(),id=source.entries[2].id;source.entries=[source.entries[2]];
 source.entries[0].sections=Array.from({length:large?73:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:large?'exact'.repeat(5600):'Retained observation '+i}));
 const f=await encryptedFixture(directory,source),media=new MediaStore(f.workspace.root,f.vault),files=await mediaFixtures(directory);
 const ready=await f.workspace.read(),record=ready.book.entries[0];record.attachments=[];
 for(let i=0;i<count;i++){
  const kind=['image','audio','video'][i%3],asset=await media.import(files[kind].bytes,kind);
  record.attachments.push({...asset,caption:'Media '+i,alt:'Description '+i,transcript:'Original transcript '+i,share:false});
 }
 if(shared)ready.book.entries.push({...structuredClone(record),id:randomUUID(),title:'Another record using the same media',sections:[]});
 await f.workspace.save(ready.book,ready.etag);
 if(large){const writing=new RecordWriting(f.workspace),target={workspaceId:source.id,recordId:id,sectionId:null},base=await writing.read(target);record.body='Extended observations '.repeat(2500);await writing.save({...target,expectedRevision:base.revision,value:{body:record.body}});}
 const values=new RecordValues(f.workspace),target=assetId=>({workspaceId:source.id,recordId:id,field:'media:'+assetId});
 return {...f,directory,book:ready.book,record,media,files,values,target,save:(base,value)=>values.save({...target(base.field.slice(6)),expectedRevision:base.revision,value:{value}}),async close(){clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
