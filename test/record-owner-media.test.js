import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile,access} from 'node:fs/promises';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {privateDirectory,digest,serialize} from '../src/storage.js';
import {contentBuffer} from '../src/file-content.js';

test('record moves retain indexed and file-backed media descriptors and exact originals',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),[from,to]=f.books,source=new LabBookStorage(from.root,from.labBookId,from.key),target=new LabBookStorage(to.root,to.labBookId,to.key),directory=new LabBookDirectory(f.registry);
 for(const book of [from,to])await directory.register(book.projectId,book);
 const original=from.before.book.entries[0],record=structuredClone(original),png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));record.attachments=[];
 for(const indexed of [true,false]){
  const id=randomUUID(),folder=await privateDirectory(source.root,'.observanda/media/'+id),metadata={id,kind:'image',extension:'png',mime:'image/png',bytes:png.length,sha256:digest(png),originalBytes:png.length,originalSha256:digest(png)};
  await source.writeFile(path.join(folder,'original'),png);await source.writeFile(path.join(folder,'public.png'),png);
  if(indexed){await source.withLock(()=>source.writeMetadata('.observanda/media-assets/'+id+'.json',serialize(metadata)));await assert.rejects(access(path.join(folder,'asset.json')),{code:'ENOENT'});}
  else await source.writeFile(path.join(folder,'asset.json'),serialize(metadata));
  record.attachments.push({id,kind:'image',caption:indexed?'Indexed descriptor':'File descriptor',alt:'Synthetic image',transcript:'',share:false});
 }
 await new ResearchRecords(source,new MediaStore(source)).save({workspaceId:from.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(original),record}]});
 const sourceOwner={projectId:from.projectId,labBookId:from.labBookId,workspaceId:from.namespaceId},targetOwner={projectId:to.projectId,labBookId:to.labBookId,workspaceId:to.namespaceId},engine=new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner,targetOwner});
 const row=await source.catalogue(async store=>store.member(await store.snapshot(),record.id));
 const result=await engine.start({id:randomUUID(),workspaceId:from.namespaceId,recordId:record.id,sourceNotebookId:from.labBookId,expectedStorageRevision:row.revision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId});assert.equal(result.phase,'complete');
 const moved=(await target.read()).book.entries.find(item=>item.id===record.id);assert.deepEqual(moved.attachments,record.attachments);assert.equal((await source.read()).book.entries.some(item=>item.id===record.id),false);
 const media=new MediaStore(target);for(const item of record.attachments){assert.deepEqual((await media.get(item.id)).bytes,png);assert.deepEqual(await contentBuffer(await media.originalContent(item.id)),png);}
 const changed=Buffer.from(png);changed[changed.length-1]^=1;await target.writeFile(path.join(target.root,'.observanda/media',record.attachments[0].id,'public.png'),changed);await assert.rejects(media.get(record.attachments[0].id),{code:'MEDIA_INVALID'});
});
