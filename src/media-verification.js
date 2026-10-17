import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {MediaStore} from './media.js';
import {MediaImports} from './media-imports.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {assertRegular} from './storage.js';
async function requiredContent(operation){try{return await operation();}catch(error){if(error.code==='ENOENT')throw new AppError('MATERIAL_MISSING');throw error;}}

// Verify references in every retained record/design revision, not only the
// current public projection. Receipts belong to the caller's fixed audit.
function* designReferences(document,projects=[]){
 for(const item of [document.website,...projects])if(item?.logoId)yield {id:item.logoId,kind:'image'};
 for(const brand of document.branding??[])for(const logo of brand.logos)yield {id:logo.id,kind:'image'};
 yield* document.website?.assets??[];
}
export class MediaVerification{
 constructor(workspace,verified){this.workspace=workspace;this.verified=verified;this.media=new MediaStore(workspace);this.imports=new MediaImports(workspace);}
 async source(id,expected){
  return requiredContent(()=>this.verified.once(['media-original',id,expected],async()=>{
   const {session,content}=await this.imports.original(id);
   if(expected&&(session.source.sha256!==expected.sha256||session.source.size!==expected.size))throw new AppError('MEDIA_INVALID');
   await content.verify();
  }));
 }
 async asset({id,kind}){
  await requiredContent(()=>this.verified.once(['media-asset',id,kind],async()=>{
   const {directory,metadata}=await this.media.metadata(id);
   if(kind&&metadata.kind!==kind)throw new AppError('MEDIA_INVALID');
   await this.media.get(id,{streamed:true});
   if(!Number.isSafeInteger(metadata.originalBytes)||metadata.originalBytes<0||metadata.originalBytes===0&&metadata.kind!=='file'||!/^[a-f0-9]{64}$/.test(metadata.originalSha256??''))throw new AppError('MEDIA_INVALID');
   if(metadata.storageId)await this.source(id,{size:metadata.originalBytes,sha256:metadata.originalSha256});
   else await (await this.media.originalContent(id,{metadata,directory})).verify();
  }));
 }
 async metadata(metadata){
  for(const ref of designReferences(metadata,metadata.projects))await this.asset(ref);
  for(const site of metadata.websites??[])for(const ref of designReferences(site.document,site.projects))await this.asset(ref);
 }
 async website(site){for(const ref of designReferences(site.document,site.projects))await this.asset(ref);}
 async websiteDocument(document){
  const logoId=(await document.field(['document','website','logoId'])).value;if(logoId)await this.asset({id:logoId,kind:'image'});
  for await(const item of document.items(['projects'])){const project=await document.tree.read(item.value);if(project.logoId)await this.asset({id:project.logoId,kind:'image'});}
  for await(const item of document.items(['document','branding']))for(const logo of (await document.tree.read(item.value)).logos)await this.asset({id:logo.id,kind:'image'});
  for await(const item of document.items(['document','website','assets']))await this.asset(await document.tree.read(item.value));
 }
 async record(record){for(const ref of record.attachments??[])await this.asset(ref);}
 async pending(){
  for await(const file of this.workspace.metadataNames('.observanda/media-imports')){
   const id=file.slice(0,-5);if(!file.endsWith('.json')||!researchId(id))throw new AppError('MEDIA_INVALID');
   const session=await this.imports.read(id);if(session.source)await this.source(id,{size:session.source.size,sha256:session.source.sha256});
  }
  // Finished conversions can remain in the library before being placed on a
  // record or page. Their accepted original and display copy also belong here.
  for await(const file of this.workspace.metadataNames('.observanda/media-assets')){
   const id=file.slice(0,-5);if(!file.endsWith('.json')||!researchId(id))throw new AppError('MEDIA_INVALID');await this.asset({id});
  }
  // Immediate imports keep their completion receipt beside the file instead
  // of in the conversion index. They can also await placement on a record.
  const directory=path.join(this.workspace.root,'.observanda/media');
  if(await assertRegular(directory,{directory:true,missing:true}))for await(const entry of await opendir(directory)){
   if(!researchId(entry.name))continue;
   const folder=path.join(directory,entry.name);await assertRegular(folder,{directory:true});
   if(await assertRegular(path.join(folder,'asset.json'),{missing:true}))await this.asset({id:entry.name});
  }
 }
}
