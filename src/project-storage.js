import {requireStorageName,storageFolderName} from './storage-names.js';
import {withProjectRetentionLease} from './project-retention-lease.js';
import {projectDomainHandoff} from './project-domain-lock.js';
import {Workspace} from './storage.js';
import {ResearchCatalogue} from './research-catalogue.js';
import {assertCatalogueOwner} from './project-catalogue-owner.js';
import {AppError} from './errors.js';

// The existing record document/index codec is reusable. Its metadata is local
// to this project; the workspace's hierarchy lives in its separate registry.
function assertProjectMetadata(metadata,projectId,code='INVALID'){
 if(!metadata||!Array.isArray(metadata.projects)||metadata.projects.length!==1||metadata.projects[0].id!==projectId||metadata.projects[0].parentId!=null||!Array.isArray(metadata.notebooks)||metadata.notebooks.some(book=>book.projectId!==projectId))throw new AppError(code);
}
class ProjectResearchCatalogue extends ResearchCatalogue{
 assertMetadata(metadata,code){assertProjectMetadata(metadata,this.workspace.projectId,code);}
 assertCurrentMetadata(metadata){this.assertMetadata(metadata);requireStorageName(this.workspace.root,metadata.title);requireStorageName(this.workspace.root,metadata.projects[0].title);}
 async snapshot(id){const value=await super.snapshot(id);this.assertMetadata(value.metadata,'CATALOGUE_DAMAGED');return value;}
 put(book,options){this.assertCurrentMetadata(book);return super.put(book,options);}
 validateMetadata(current,metadata,options){this.assertMetadata(metadata);return super.validateMetadata(current,metadata,options);}
 commitChanges(currentId,current,metadata,modified,options){this.assertCurrentMetadata(metadata);return super.commitChanges(currentId,current,metadata,modified,options);}
 finishRecordChanges(currentId,current,metadata,before,after,options){this.assertCurrentMetadata(metadata);return super.finishRecordChanges(currentId,current,metadata,before,after,options);}
}
export class ProjectStorage extends Workspace{
 constructor(root,projectId,vault){super(root,vault);assertCatalogueOwner(null,projectId);if(projectId===undefined)throw new AppError('INVALID');this.projectId=projectId;}
 prepareRestoredBook(previous,current){super.prepareRestoredBook(previous,current);previous.title=storageFolderName(this.root);previous.projects[0].title=previous.title;return previous;}
 catalogueStore(db,options){return new ProjectResearchCatalogue(this,db,options);}
 openCatalogue(options={}){
  if(options.projectId!==undefined&&options.projectId!==this.projectId)throw new AppError('DATABASE_LOCATION');
  return super.openCatalogue({...options,projectId:this.projectId});
 }
 withStorageHandoff(operation,options){return withProjectRetentionLease(this,()=>super.withLock(internal=>this.catalogue(async store=>{await projectDomainHandoff(store.db);return operation(internal);}),options));}
 initializeResearch(book,metadata,populate){assertProjectMetadata(book,this.projectId);requireStorageName(this.root,book.title);requireStorageName(this.root,book.projects[0].title);return super.initializeResearch(book,metadata,populate);}
}
export {initializeProjectLocation} from './project-initialization.js';
