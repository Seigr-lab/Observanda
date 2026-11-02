import {projectPdfSection,pdfFileResearch,checkPdfSources} from './pdf-publication-files.js';
import {serialize} from './storage-format.js';
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
 constructor(storage,workspaceId,{publicationFiles=null}={}){this.publicationFiles=publicationFiles;if(!researchId(workspaceId))throw new AppError('INVALID');this.storage=storage;this.workspaceId=workspaceId;this.domains=new ProjectDomains(storage,workspaceId);}
 async available(){return this.storage.catalogue(async store=>{if((await store.snapshot()).metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');return (await readProjectDomainRegistry(store))?.domains.includes('pdf')??false;});}
 async read(operation,data={},options={}){
  if(!['list','archive','openArchived','open','sections','outline','section','history','verify','layouts'].includes(operation))throw new AppError('INVALID');
  if(!await this.available()){if(operation==='list'||operation==='archive'||operation==='layouts')return {items:[],next:null};throw new AppError('NOT_FOUND');}
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf');if(operation==='layouts')return new PdfLayoutLibrary(store).list(data);const documents=new PdfDocumentStore(store);
   if(operation==='list'||operation==='archive'||operation==='verify')return documents[operation](operation==='verify'?options:data);
   if(operation==='section'){const saved=await documents.section(data.id,data.sectionId,data),proof=new Map(),result=await projectPdfSection(store,this.publicationFiles,data.id,saved.section,{...options,proof});await checkPdfSources(this.publicationFiles,[...proof.values()]);return {...saved,section:result.section};}
   if(operation==='sections'||operation==='outline'){
    const result=operation==='outline'?await documents.outline(data.id,{...data,query:''},options):await documents.sections(data.id,data),items=[],proof=new Map();
    const needle=operation==='outline'?(data.query??'').normalize('NFKC').trim().toLowerCase():'';if(needle.length>240)throw new AppError('INVALID');
    for(const item of result.items){const saved=await documents.section(data.id,item.id,{revision:result.revision}),resolved=await projectPdfSection(store,this.publicationFiles,data.id,saved.section,{...options,proof});
     if(!needle||resolved.section.title.normalize('NFKC').toLowerCase().includes(needle))items.push({...item,title:resolved.section.title});
    }await checkPdfSources(this.publicationFiles,[...proof.values()]);return {...result,...(operation==='outline'?{query:needle}:{}),items};
   }
   return documents[operation](data.id,data,options);
  },options);
 }
 async changeLayout(command,options={}){
  validatePdfLayoutCommand(command);options.signal?.throwIfAborted();
  if(!await this.available())await this.domains.initialize(['pdf']);
  return this.domains.run(['pdf'],get=>new PdfLayoutLibrary(get('pdf')).change(command,options),{...options,write:['pdf']});
 }
 async change(command,options={}){
  validatePdfCommand(command);options.signal?.throwIfAborted();
  if(!await this.available())await this.domains.initialize(['pdf']);
  const operationSection=command.operation.section;
  if(operationSection){
   if(command.operation.type==='section'){
    const prior=(await this.read('section',{id:command.id,sectionId:operationSection.id,revision:command.expectedRevision},options)).section;
    if(prior.research&&!operationSection.research)throw new AppError('PDF_SOURCE_CONTENT');
   }
   if(operationSection.research){const r=operationSection.research,selected=await pdfFileResearch(this.publicationFiles,{operation:'selection',sourceId:r.workspaceId,snapshotId:r.snapshotId,recordId:r.recordId,collection:r.collection,itemId:r.itemId,...(r.blockId?{blockId:r.blockId}:{})},options);if(serialize(selected)!==serialize(r))throw new AppError('PDF_SOURCE_CONTENT');}
  }
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
