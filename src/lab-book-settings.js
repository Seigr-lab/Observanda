import {configurationCheckpoint} from './configuration-commands.js';
import {validConfigurationReference} from './web/configuration-reference.js';
import {digest,serialize} from './storage-format.js';
// A book's own settings and name share its writer and recoverable rename.
import {LabBookRenames} from './lab-book-rename.js';
import {LabBookStorage} from './lab-book-storage.js';
import {StructureCommands} from './structure-commands.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validConfiguration} from './web/notebook-schema.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
export class LabBookSettings{
 constructor(project){this.project=project;this.renames=new LabBookRenames(project);}
 async save(storage,command,{check=async()=>{},stopJobs=async()=>{}}={}){
  if(!command||Object.keys(command).some(key=>!['book','etag','id','configurationDraft','configurationPin'].includes(key))||!researchId(command.id)||!revisionId(command.etag))throw new AppError('INVALID');
  const {book,id,etag}=command,selected=command.configurationDraft!==undefined||command.configurationPin!==undefined;
  if(!book||!['configuration,id,projectId,title',...(selected?['id,projectId,title']:[])].includes(Object.keys(book).filter(key=>key!=='share').sort().join())||Object.hasOwn(book,'share')&&typeof book.share!=='boolean'||book.id!==storage.labBookId||book.projectId!==this.project.projectId||!selected&&!validConfiguration(book.configuration)&&!validConfigurationReference(book.configuration))throw new AppError('INVALID');
  validateStorageName(book.title);await check();
  const receipt=await this.renames.read(id),current=await storage.outline(),name=current.metadata.notebooks[0].title;
  if(receipt||name!==book.title){
   const permission=Object.hasOwn(book,'share')?{share:book.share}:{};
   let settings={etag,configuration:book.configuration,...permission};
   if(selected){
    const input=digest(serialize({etag,book,draft:command.configurationDraft,pin:command.configurationPin}));
    if(receipt){if(receipt.settings?.input!==input)throw new AppError('CONFLICT');settings=receipt.settings;}
    else{const owner={workspaceId:current.metadata.id,projectId:this.project.projectId,notebookId:storage.labBookId,slot:'configuration'},checkpoint=await storage.catalogue(store=>configurationCheckpoint(store,owner,command.configurationDraft,command.configurationPin));settings={etag,...permission,...(checkpoint.absent?{}:{configuration:checkpoint.configuration}),input,...(checkpoint.draft?{checkpoint:command.configurationDraft}:{})};}
   }
   await stopJobs();const result=await this.renames.run(storage,{id,name:book.title,expectedName:receipt?.source??name,settings,check});
   const target=new LabBookStorage(result.book.root,storage.labBookId,storage.vault);
   return {...await target.catalogue(store=>store.recordOutline()),location:result.book};
  }
  return new StructureCommands(storage).execute('structure',{etag,commandId:id,response:'outline',change:{kind:'notebook',value:book},...(selected?{configurationDraft:command.configurationDraft,configurationPin:command.configurationPin}:{})});
 }
}
