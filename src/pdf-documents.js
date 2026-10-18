import {ProjectDomains} from './project-domains.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {PdfDocumentStore,validatePdfCommand} from './pdf-document-store.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
// The PDF owner has independent locks and encrypted objects. Reads never
// initialize storage or queue a write as a side effect of opening an editor.
export class PdfDocuments{
 constructor(storage,workspaceId){if(!researchId(workspaceId))throw new AppError('INVALID');this.storage=storage;this.workspaceId=workspaceId;this.domains=new ProjectDomains(storage,workspaceId);}
 async available(){return this.storage.catalogue(async store=>{if((await store.snapshot()).metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');return (await readProjectDomainRegistry(store))?.domains.includes('pdf')??false;});}
 async read(operation,data={},options={}){
  if(!['list','open','sections','section','history','verify'].includes(operation))throw new AppError('INVALID');
  if(!await this.available()){if(operation==='list')return {items:[],next:null};throw new AppError('NOT_FOUND');}
  return this.domains.run(['pdf'],get=>{const documents=new PdfDocumentStore(get('pdf'));if(operation==='list'||operation==='verify')return documents[operation](operation==='verify'?options:data);if(operation==='section')return documents.section(data.id,data.sectionId,data);return documents[operation](data.id,data);},options);
 }
 async change(command,options={}){
  validatePdfCommand(command);options.signal?.throwIfAborted();
  if(!await this.available())await this.domains.initialize(['pdf']);
  return this.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change(command,options),{...options,write:['pdf']});
 }
}
