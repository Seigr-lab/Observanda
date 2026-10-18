import {preparePdfFont,retainPdfDocumentFont} from './pdf-document-fonts.js';
import {pdfSectionFontIds} from './web/pdf-font-model.js';
import {BUNDLED_FONTS,customFontId} from './web/font-catalogue.js';
import {PdfLayoutLibrary,validatePdfLayoutCommand} from './pdf-layout-library.js';
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
  if(!['list','archive','openArchived','open','sections','outline','section','history','verify','layouts'].includes(operation))throw new AppError('INVALID');
  if(!await this.available()){if(operation==='list'||operation==='archive'||operation==='layouts')return {items:[],next:null};throw new AppError('NOT_FOUND');}
  return this.domains.run(['pdf'],get=>{if(operation==='layouts')return new PdfLayoutLibrary(get('pdf')).list(data);const documents=new PdfDocumentStore(get('pdf'));if(operation==='list'||operation==='archive'||operation==='verify')return documents[operation](operation==='verify'?options:data);if(operation==='section')return documents.section(data.id,data.sectionId,data);return documents[operation](data.id,data,options);},options);
 }
 async changeLayout(command,options={}){
  validatePdfLayoutCommand(command);options.signal?.throwIfAborted();
  if(!await this.available())await this.domains.initialize(['pdf']);
  return this.domains.run(['pdf'],get=>new PdfLayoutLibrary(get('pdf')).change(command,options),{...options,write:['pdf']});
 }
 async change(command,options={}){
  validatePdfCommand(command);options.signal?.throwIfAborted();
  if(!await this.available())await this.domains.initialize(['pdf']);
  const {operation}=command,ids=[...new Set([...(operation.header?[operation.header.layout.font]:[]),...pdfSectionFontIds(operation.section)])];
  for(const id of ids)if(!customFontId(id)&&!BUNDLED_FONTS.some(font=>font.id===id))throw new AppError('PDF_FONT',[id]);
  const custom=ids.filter(customFontId);if(!custom.length)return this.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change(command,options),{...options,write:['pdf']});
  const prior=await this.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),receipt=await store.object('pdf:command:'+command.id+':'+command.commandId);if(receipt)return {replay:true};return {fonts:command.expectedRevision?(await owner.open(command.id,{revision:command.expectedRevision})).header.fonts??[]:[]};},options);
  const prepared=[];
  if(!prior.replay)for(const id of custom){if(prior.fonts.some(pin=>pin.id===id))continue;const captured=options.preparedFonts?.get(id);if(options.preparedFonts&&!captured)throw new AppError('PDF_FONT',[id]);prepared.push(captured??await preparePdfFont(this.storage,id,options));}
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf'),owner=new PdfDocumentStore(store),fontPins=(prior.fonts??[]).filter(pin=>custom.includes(pin.id));for(const value of prepared)fontPins.push(await retainPdfDocumentFont(store,command.id,value,options));
   const result=await owner.change(command,{...options,fontPins});return {...result,fonts:(await owner.revision(command.id,result.revision)).header.fonts??[]};
  },{...options,write:['pdf']});
 }
}
