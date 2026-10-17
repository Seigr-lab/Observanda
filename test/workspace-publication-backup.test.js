import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {MediaStore} from '../src/media.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {PublicationDocumentBuilder} from '../src/publication-document.js';
import {copyPlan,copyWorkspace,inspectLocation} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {contentBuffer} from '../src/file-content.js';
import {MediaImports} from '../src/media-imports.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {randomUUID} from 'node:crypto';

test('verified backups require retained original media, its display copy and prepared website files',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-backup-publication-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const media=new MediaStore(f.workspace.root,f.vault),original=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>');
 const asset=await media.import(original,'image'),before=await f.workspace.read();
 // A completed immediate import is accepted evidence even before placement.
 const originalFile=path.join(f.workspace.root,'.observanda/media',asset.id,'original'),ciphertext=await readFile(originalFile);await unlink(originalFile);
 try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'unplaced-immediate')),{vault:f.vault}),{code:'MATERIAL_MISSING'});}
 finally{await writeFile(originalFile,ciphertext);}
 before.book.entries[0].attachments=[{...asset,caption:'Synthetic retained figure',alt:'Green square',transcript:'',share:true}];await f.workspace.save(before.book,before.etag);
 const releases=new PublicationJobs(f.workspace),edition=await releases.inline(await releases.workspace.outline()),rendered=await media.get(asset.id,{streamed:true});
 // Media in an earlier revision remains required even after the current record
 // no longer displays it.
 const current=await f.workspace.read();current.book.entries[0].attachments=[];await f.workspace.save(current.book,current.etag);
 const files=[['original',path.join(f.workspace.root,'.observanda/media',asset.id,'original')],['display',rendered.bytes.file],['edition',(await edition.files.get(edition.defaultPage)).file]];
 for(const [kind,file] of files)await t.test(kind+' missing from source',async()=>{
  const ciphertext=await readFile(file),destination=path.join(directory,'missing-'+kind);await unlink(file);
  try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,destination),{vault:f.vault}),{code:kind==='edition'?'JOB_DAMAGED':'MATERIAL_MISSING'});await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});}
  finally{await writeFile(file,ciphertext);}
 });
 const candidatePath='.observanda/release-candidates/'+edition.reviewId+'.json',candidate=await f.workspace.readMetadata(candidatePath,16*1024*1024);
 // A consistent file count/index alone cannot substitute for the edition's
 // independent manifest of all files and their identities.
 const output=edition.files.output,missingManifest=await releases.workspace.withLock(async()=>{
  const builder=new PublicationDocumentBuilder(releases.workspace,{owner:output.descriptor.owner,collections:Object.fromEntries(output.collectionNames().map(name=>[name,{indexes:[]}]))});
  for(const collection of output.collectionNames())for await(const row of output.items(collection)){if((collection==='files'||collection==='blobIndexes')&&row.value.name==='publication.json')continue;await builder.append(collection,row.key,row.value);}
  return builder.finish({header:await output.header()});
 });
 for(const [name,change,code] of [['missing-manifest',{output:missingManifest},'STALE'],['wrong-edition',{id:'0'.repeat(64)},'JOB_DAMAGED']]){
  await f.workspace.withLock(()=>f.workspace.writeMetadata(candidatePath,JSON.stringify({...JSON.parse(candidate),...change})));
  try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,name)),{vault:f.vault}),{code});}
  finally{await f.workspace.withLock(()=>f.workspace.writeMetadata(candidatePath,candidate));}
 }
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'valid')),{vault:f.vault});
 const restored=new Workspace(destination,f.vault),again=await new PublicationJobs(restored).read(edition.reviewId);
 for await(const [name,content] of edition.files)assert.deepEqual(await contentBuffer(await again.files.get(name)),await contentBuffer(content));
 assert.deepEqual(await restored.readFile(path.join(destination,'.observanda/media',asset.id,'original')),original);
});

test('pending media originals and independent project editions participate in the same restore audit',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-backup-scoped-media-')),f=await encryptedFixture(directory,sampleNotebook()),imports=new MediaImports(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>');
 const pending=await imports.start({name:'pending.svg',size:bytes.length,kind:'image'});await imports.receive(pending.id,[bytes]);
 const rejectMissing=async(file,label)=>{
  const ciphertext=await readFile(file),destination=path.join(directory,label);await unlink(file);
  try{await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,destination),{vault:f.vault}),{code:label==='scoped-edition'?'JOB_DAMAGED':'MATERIAL_MISSING'});await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});}
  finally{await writeFile(file,ciphertext);}
 };
 await rejectMissing((await imports.original(pending.id)).content.file,'pending-original');
 const prepared=await imports.prepare(pending.id,randomUUID(),{});await f.workspace.withLock(()=>imports.commit(pending.id,prepared));
 await rejectMissing((await new MediaStore(f.workspace.root,f.vault).get(pending.id,{streamed:true})).bytes.file,'unplaced-display');
 const sites=new WebsiteSites(f.workspace),initial=await f.workspace.outline(),projectId=initial.metadata.projects[0].id;
 const site=await sites.change({workspaceId:initial.metadata.id,etag:initial.etag,operation:'create',name:'Separate project site'});
 const selected=await sites.read(site.id);
 await sites.save(site.id,{workspaceId:initial.metadata.id,baseEtag:selected.etag,websitePin:selected.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[projectId],records:[]}});
 const scoped=websiteWorkspace(f.workspace,site.id),edition=await new PublicationJobs(scoped).inline(await scoped.outline());
 await rejectMissing((await edition.files.get(edition.defaultPage)).file,'scoped-edition');
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'verified')),{vault:f.vault}),restored=new Workspace(destination,f.vault);
 assert.deepEqual(await contentBuffer((await new MediaImports(restored).original(pending.id)).content),bytes);
 const again=await new PublicationJobs(websiteWorkspace(restored,site.id)).read(edition.reviewId);
 for await(const [name,content] of edition.files)assert.deepEqual(await contentBuffer(await again.files.get(name)),await contentBuffer(content));
});
