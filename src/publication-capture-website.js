// Capture website originals individually while their keyed descriptors enter
// the shared publication document. Streams are consumed once, and collision
// claims reject any authored identity that aliases an opaque filename.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {validWebsitePage,validWebsiteLayout,validWebsiteBranding} from './web/website-item-validation.js';
import {publicationExcerpt} from './web/publication-card.js';
const invalid=()=>{throw new AppError('INVALID');};
const file=(job,id)=>'.observanda/release-inputs/'+job+'/'+id+'.json';
export async function reservePublicationIds(builder,value,{signal}={}){
 signal?.throwIfAborted();
 if(typeof value==='string'){if(researchId(value)){const file=await builder.get('fileIds',value);if(file&&file.kind!=='record')throw new AppError('PUBLICATION_IDENTITY');if(!await builder.get('reservedIds',value))await builder.append('reservedIds',value,{id:value});}return;}
 if(Array.isArray(value)){for(const item of value)await reservePublicationIds(builder,item,{signal});}
 else if(value&&typeof value==='object')for(const item of Object.values(value))await reservePublicationIds(builder,item,{signal});
}
export async function claimPublicationFile(builder,id,kind,key){await builder.append('fileIds',id,{kind,key});}
async function opaqueFile(workspace,builder,jobId,kind,key,{signal}={}){
 for(;;){
  signal?.throwIfAborted();const id=randomUUID();if(await builder.get('reservedIds',id)||await builder.get('identities',id)||await builder.get('fileIds',id))continue;
  let exists;try{exists=await workspace.readMetadata(file(jobId,id),0)!==null;}catch(error){if(error.code==='LIMIT')exists=true;else throw error;}if(exists)continue;
  await claimPublicationFile(builder,id,kind,key);return id;
 }
}
export async function retainWebsitePublicationCollections(workspace,builder,jobId,metadata,{websiteCollections,websitePages,websitePresentation,signal}={}){
 const legacy={pages:metadata.pages,navigation:metadata.website.navigation,assets:metadata.website.assets,layouts:metadata.website.layouts,branding:metadata.branding,presentationMedia:metadata.website.presentation.media,covers:metadata.website.presentation.covers},streams={};
 for(const [name,values] of Object.entries(legacy))streams[name]=websiteCollections?.[name]??websitePresentation?.[name]??{count:values?.length??0,items:values??[]};
 await reservePublicationIds(builder,metadata,{signal});
 for(const stream of Object.values(streams)){
  if(!stream||!Number.isSafeInteger(stream.count)||stream.count<0||!stream.items)invalid();
 }
 for(const [name,stream] of Object.entries(streams)){
  let count=0;
  for await(const value of stream.items){
   signal?.throwIfAborted();if(++count>stream.count)invalid();await reservePublicationIds(builder,value,{signal});
   if(name==='pages'){
    if(!validWebsitePage(value,{formatVersion:metadata.formatVersion}))invalid();
    const label={id:value.id,title:value.title,body:'',share:value.share,sections:[]};await builder.append('pages',label.id,label,{indexes:label.share?{shared:'yes/'}:{}});
   }else if(name==='layouts'||name==='branding'){
    if(!(name==='layouts'?validWebsiteLayout(value,{formatVersion:metadata.formatVersion}):validWebsiteBranding(value)))invalid();
    const collection=name==='layouts'?'layoutInputs':'brandingInputs',raw=serialize(value),fileId=await opaqueFile(workspace,builder,jobId,collection,value.target,{signal});
    await workspace.writeMetadata(file(jobId,fileId),raw);await builder.append(collection,value.target,{target:value.target,fileId,sha256:digest(raw),bytes:Buffer.byteLength(raw)});
   }else{
    const key=name==='navigation'?value.target:name==='covers'?value.entryId:name==='presentationMedia'?value.scope+'/'+value.id:value.id;
    await builder.append(name,key,value,{indexes:name==='assets'?{kind:value.kind+'/'}:name==='presentationMedia'?{scope:value.scope+'/'}:{}});
   }
  }
  if(count!==stream.count)invalid();
 }
 const originals=websitePages??metadata.pages??[];
 for await(const page of originals){
  signal?.throwIfAborted();const label=await builder.get('pages',page.id);
  if(!label||!validWebsitePage(page,{formatVersion:metadata.formatVersion})||page.id!==label.id||page.title!==label.title||page.share!==label.share)invalid();if(!page.share)continue;
  const raw=serialize(page),fileId=await opaqueFile(workspace,builder,jobId,'pageInputs',page.id,{signal});await workspace.writeMetadata(file(jobId,fileId),raw);
  await builder.append('pageInputs',page.id,{id:page.id,fileId,sha256:digest(raw),bytes:Buffer.byteLength(raw),excerpt:publicationExcerpt(page.body),hasBody:Boolean(page.body)});
 }
 const shared=(await builder.window('pages',{index:'shared',prefix:'yes/',limit:1})).total;if(builder.count('pageInputs')!==shared)invalid();
}
