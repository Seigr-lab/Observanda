import {Workspace} from './storage.js';
import {ResearchCatalogue} from './research-catalogue.js';
import {assertLabBookCatalogueOwner} from './lab-book-catalogue-owner.js';
import {requireStorageName,storageFolderName} from './storage-names.js';
import {AppError} from './errors.js';

function assertMetadata(metadata,labBookId,code='INVALID'){
 const project=metadata?.projects?.[0],book=metadata?.notebooks?.[0];
 if(!project||!book||!Array.isArray(metadata?.projects)||metadata.projects.length!==1||project.parentId!=null||!Array.isArray(metadata.notebooks)||metadata.notebooks.length!==1||book.id!==labBookId||book.projectId!==project.id)throw new AppError(code);
}
class LabBookResearchCatalogue extends ResearchCatalogue{
 assertMetadata(metadata,code){assertMetadata(metadata,this.workspace.labBookId,code);}
 assertCurrentMetadata(metadata){this.assertMetadata(metadata);requireStorageName(this.workspace.root,metadata.title);requireStorageName(this.workspace.root,metadata.notebooks[0].title);}
 async snapshot(id){const value=await super.snapshot(id);this.assertMetadata(value.metadata,'CATALOGUE_DAMAGED');return value;}
 put(book,options){this.assertCurrentMetadata(book);return super.put(book,options);}
 validateMetadata(current,metadata,options){this.assertMetadata(metadata);return super.validateMetadata(current,metadata,options);}
 commitChanges(currentId,current,metadata,modified,options){this.assertCurrentMetadata(metadata);return super.commitChanges(currentId,current,metadata,modified,options);}
 finishRecordChanges(currentId,current,metadata,before,after,options){this.assertCurrentMetadata(metadata);return super.finishRecordChanges(currentId,current,metadata,before,after,options);}
}
export class LabBookStorage extends Workspace{
 constructor(root,labBookId,vault){super(root,vault);assertLabBookCatalogueOwner(null,labBookId);this.labBookId=labBookId;}
 prepareRestoredBook(previous,current){super.prepareRestoredBook(previous,current);previous.title=storageFolderName(this.root);previous.notebooks[0].title=previous.title;previous.projects=structuredClone(current.projects);previous.notebooks[0].projectId=current.notebooks[0].projectId;return previous;}
 catalogueStore(db,options){return new LabBookResearchCatalogue(this,db,options);}
 openCatalogue(options={}){
  if(options.projectId!==undefined||options.labBookId!==undefined&&options.labBookId!==this.labBookId)throw new AppError('DATABASE_LOCATION');
  return super.openCatalogue({...options,labBookId:this.labBookId});
 }
 initializeResearch(book,metadata,populate){assertMetadata(book,this.labBookId);requireStorageName(this.root,book.notebooks[0].title);return super.initializeResearch(book,metadata,populate);}
}
