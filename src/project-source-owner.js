import {importedMediaOwner} from './project-imported-media-owner.js';
import {retiredMetadataSourceLocation} from './project-retired-metadata.js';
import {projectSourceModuleEntry} from './project-source-module-entry.js';
import {Reviews} from './reviews.js';
import {readReviewSummary} from './review-summaries.js';
// Domain owners provide stable identity and current revision for persisted
// legacy choices. Call inside the selected source catalogue's fixed read.
import {ProjectOwnerDeclarations} from './project-owner-declarations.js';
import {MediaStore} from './media.js';
import {MediaImports} from './media-imports.js';
import {RecordStarters,STARTER_ROOT} from './record-starters.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {workspaceModules} from './modules/index.js';
import {moduleOwnerFact} from './project-module-ownership.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value));
export class ProjectSourceOwner{
 constructor(store,namespaceId){this.store=store;this.workspace=store.workspace;this.namespaceId=namespaceId;this.declarations=new ProjectOwnerDeclarations(this.workspace,namespaceId);}
 async retired(domain,id){const roots={media:'.observanda/media-assets',mediaImport:'.observanda/media-imports',starter:STARTER_ROOT+'/headers',starterUpload:'.observanda/record-starter-uploads',review:'.observanda/reviews'};return roots[domain]?retiredMetadataSourceLocation(this.store,'metadata:'+roots[domain]+'/'+id+'.json'):null;}
 async describe(domain,id,knownEntity){
  this.declarations.file(domain,id);const current=await (this.current??=this.store.snapshot());if(current.metadata.id!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  const retired=await this.retired(domain,id);if(retired)return {retired:true,revision:retired.revision,projectIds:current.metadata.projects.map(item=>item.id),fact:{kind:'project',projectId:retired.owner.projectId}};
  return this.workspace.inspectCatalogue(this.store,async()=>{
   let value,identity,fact;
   if(domain==='media'){
    ({metadata:value}=await new MediaStore(this.workspace).metadata(id));identity={id,kind:value.kind,originalBytes:value.originalBytes,originalSha256:value.originalSha256};
    if(value.storageId)fact=await importedMediaOwner(this.workspace,value,id=>this.resolve('mediaImport',id));
   }else if(domain==='mediaImport'){
    value=await new MediaImports(this.workspace).read(id);if(value.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');identity={id,kind:value.kind,name:value.name,size:value.size,createdAt:value.createdAt};
   }else if(domain==='starter'){
    const {revision,...header}=await new RecordStarters(this.workspace).header(id);return {identity:hash({id,createdAt:header.createdAt}),revision,projectIds:current.metadata.projects.map(item=>item.id)};
   }else if(domain==='starterUpload'){
    value=await new RecordStarters(this.workspace).object('.observanda/record-starter-uploads/'+id+'.json');if(!new RecordDraftChunks(this.workspace,id,{starter:true}).valid(value,{complete:false}))throw new AppError('CATALOGUE_DAMAGED');identity={id,bytes:value.bytes,sha256:value.sha256};
   }else if(domain==='module'){
    if(knownEntity){if(knownEntity.id!==id)throw new AppError('INVALID');value=knownEntity;}else{const catalogue=new ModuleCatalogue(this.store),head=await(this.moduleHead??=catalogue.head(this.namespaceId));const entry=await projectSourceModuleEntry(catalogue,head,id);if(entry?.retired)return {identity:hash(entry.identity),revision:entry.hash,projectIds:current.metadata.projects.map(item=>item.id),fact:entry.owner,retired:true};value=entry?.value;}if(!value)throw new AppError('NOT_FOUND');workspaceModules(this.workspace).validateEntity(value);identity={id,type:value.type,createdAt:value.createdAt};fact=moduleOwnerFact(value);
   }else if(domain==='review'){
    const reviews=new Reviews(this.workspace);value=knownEntity??await readReviewSummary(this.workspace,id,key=>reviews.packet(key),{cache:false});if(value.id!==id)throw new AppError('INVALID');identity={id,direction:value.direction,workspaceId:value.workspaceId,createdAt:value.createdAt,contact:value.contact,records:value.records.map(({id,revision})=>({id,revision}))};
   }else if(domain==='font'){
    value=(await new WorkspaceFonts(this.workspace).list()).find(item=>item.id===id);if(!value)throw new AppError('FONT_MISSING');identity={id};
   }else throw new AppError('INVALID');
   return {identity:hash(identity),revision:hash(value),projectIds:current.metadata.projects.map(item=>item.id),...(fact?{fact}:{})};
  });
 }
 resolveDecision(domain,id,descriptor,decision){
  const assigned=this.declarations.resolveDecision(domain,id,descriptor,decision);
  return assigned??(domain==='media'&&descriptor.fact?{id,sourceNamespace:this.namespaceId,revision:descriptor.revision,...descriptor.fact}:null);
 }
 async resolve(domain,id,knownEntity){
  const descriptor=await this.describe(domain,id,knownEntity);return descriptor.retired?{id,sourceNamespace:this.namespaceId,revision:descriptor.revision,...descriptor.fact}:this.resolveDecision(domain,id,descriptor,await this.declarations.read(domain,id));
 }
}
