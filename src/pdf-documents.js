import {projectPdfSection,pdfFileResearch,checkPdfSources} from './pdf-publication-files.js';
import {serialize} from './storage-format.js';
import {preparePdfFont,retainPdfDocumentFont} from './pdf-document-fonts.js';
import {pdfSectionFontIds} from './web/pdf-font-model.js';
import {BUNDLED_FONTS,customFontId} from './web/font-catalogue.js';
import {PdfLayoutLibrary,validatePdfLayoutCommand} from './pdf-layout-library.js';
import {ProjectDomains} from './project-domains.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {PdfDocumentStore,validatePdfCommand} from './pdf-document-store.js';
import {validatePdfLibraryQuery} from './pdf-library-index.js';
import {PdfLibraryOrganization,validatePdfLabelEdit,validatePdfLabelQuery} from './pdf-library-organization.js';
import {PublicationTemplates,validateTemplatePublication} from './pdf-publication-template-library.js';
import {publicationFontFiles,pdfStarterRevision,inspectPublicationStarter,validatePublicationStarter} from './pdf-publication-starters.js';
import {latestPdfLibraryExport,queuePdfExport} from './pdf-export-jobs.js';
import {randomUUID} from 'node:crypto';
import {proseText} from './web/prose-model.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
// The PDF owner has independent locks and encrypted objects. Reads never
// initialize storage or queue a write as a side effect of opening an editor.
export class PdfDocuments{
 constructor(storage,workspaceId,{publicationFiles=null}={}){this.publicationFiles=publicationFiles;if(!researchId(workspaceId))throw new AppError('INVALID');this.storage=storage;this.workspaceId=workspaceId;this.domains=new ProjectDomains(storage,workspaceId);}
 async available(){return this.storage.catalogue(async store=>{if((await store.snapshot()).metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');return (await readProjectDomainRegistry(store))?.domains.includes('pdf')??false;});}
 async read(operation,data={},options={}){
  if(!['list','archive','library-query','openArchived','open','sections','outline','section','history','verify','layouts'].includes(operation))throw new AppError('INVALID');
  if(operation==='library-query')validatePdfLibraryQuery(data);
  if(!await this.available()){if(operation==='library-query')return {ready:true,items:[],next:null};if(operation==='list'||operation==='archive'||operation==='layouts')return {items:[],next:null};throw new AppError('NOT_FOUND');}
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf');if(operation==='layouts')return new PdfLayoutLibrary(store).list(data);const documents=new PdfDocumentStore(store);
   if(operation==='library-query')return documents.libraryQuery(data,options);
   if(operation==='list'||operation==='archive'||operation==='verify')return documents[operation](operation==='verify'?options:data);
   if(operation==='section'){const saved=await documents.section(data.id,data.sectionId,data),proof=new Map(),result=await projectPdfSection(store,this.publicationFiles,data.id,saved.section,{...options,proof});await checkPdfSources(this.publicationFiles,[...proof.values()]);return {...saved,section:result.section};}
   if(operation==='sections'||operation==='outline'){
    const result=operation==='outline'?await documents.outline(data.id,{...data,query:''},options):await documents.sections(data.id,data),items=[],proof=new Map();
    const needle=operation==='outline'?(data.query??'').normalize('NFKC').trim().toLowerCase():'';if(needle.length>240)throw new AppError('INVALID');
    for(const item of result.items){const saved=await documents.section(data.id,item.id,{revision:result.revision}),resolved=await projectPdfSection(store,this.publicationFiles,data.id,saved.section,{...options,proof});
     if(!needle||resolved.section.title.normalize('NFKC').toLowerCase().includes(needle)){
      const usesPublication=Boolean(saved.section.research||saved.section.images?.length);
      items.push({...item,title:resolved.section.title,...(usesPublication?{hasPublicationContent:true}:{})});
     }
    }await checkPdfSources(this.publicationFiles,[...proof.values()]);return {...result,...(operation==='outline'?{query:needle}:{}),items};
   }
   const result=await documents[operation](data.id,data,options);
   if((operation==='open'||operation==='openArchived')&&result.starter){
    const definition=await new PublicationTemplates(store).value(result.starter.id,result.starter.revision);
    const rows=new Map(definition.sections.map(row=>[row.id,row]));
    result.starter={...result.starter,name:definition.name,language:definition.language,guidance:Object.fromEntries(result.starter.sections.map(row=>[row.sectionId,rows.get(row.slot)?.guidance??'']))};
   }
   return result;
  },options);
 }
 async template(action,input,options={}){
  if(!['template-list','template-read','template-publish','template-inspect','template-style','template-review'].includes(action))throw new AppError('INVALID');
  const publish=action==='template-publish';
  const work=async store=>{
   const library=new PublicationTemplates(store);
   if(action==='template-list')return library.list(input);
   if(action==='template-read')return library.head(input.id,input.language);
   if(action==='template-inspect'||action==='template-style'){
    if(Object.keys(input).join()!=='value')throw new AppError('INVALID');
    if(action==='template-inspect')return inspectPublicationStarter(input.value);
    const selected={...input.value,fontFiles:publicationFontFiles(input.value?.layout?.font)};
    const value=validatePublicationStarter(selected);return {value,revision:pdfStarterRevision(value),builtIn:false};
   }
   if(action==='template-review'){
    if(Object.keys(input).sort().join()!=='id,revision'||!store)throw new AppError('INVALID');
    const doc=await new PdfDocumentStore(store).open(input.id,{revision:input.revision});
    if(!doc.starter)throw new AppError('NOT_FOUND');
    const old=await library.value(doc.starter.id,doc.starter.revision),current=await library.head(doc.starter.id,old.language);
    return {old:{value:old,revision:doc.starter.revision},current};
   }
   return library.publish(input,options);
  };
  if(!await this.available()){
   if(!publish)return work(null);
   validateTemplatePublication(input);
   await this.domains.initialize(['pdf']);
  }
  return this.domains.run(['pdf'],get=>work(get('pdf')),{...options,...(publish?{write:['pdf']}:{})});
 }
 async prepareLibrary(input,options={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new AppError('INVALID');
  if(!await this.available())return {ready:true};
  return this.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).prepareLibrary(options),{...options,write:['pdf']});
 }
 async libraryDetails(input,options={}){
  if(!input||Object.keys(input).sort().join()!=='cursor,id,revision'||!researchId(input.id))throw new AppError('INVALID');
  if(!await this.available())throw new AppError('NOT_FOUND');
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf'),documents=new PdfDocumentStore(store),head=await documents.open(input.id);
   if(head.revision!==input.revision)throw new AppError('CONFLICT');
   const exported=await latestPdfLibraryExport(store,input.id,input.cursor,options);
   const previews=[],proof=new Map();
   if(input.cursor===null){
    const sections=await documents.sections(input.id,{revision:head.revision,limit:3});
    for(const item of sections.items){
     const {section:saved}=await documents.section(input.id,item.id,{revision:head.revision});
     const {section,withdrawn}=await projectPdfSection(store,this.publicationFiles,input.id,saved,{...options,proof});
     if(!withdrawn)previews.push({title:section.title,excerpt:proseText(section.content).slice(0,180),source:section.research?.title??null});
    }
   }
   await checkPdfSources(this.publicationFiles,[...proof.values()]);await options.check?.();
   return {edition:head.sequence+1,exported,previews,protected:proof.size>0};
  },options);
 }
 async organizeLibrary(operation,input,options={}){
  if(!['library-labels','library-review','library-label-edit','library-batch'].includes(operation))throw new AppError('INVALID');
  const edit=operation==='library-label-edit',batch=operation==='library-batch';
  if(edit)validatePdfLabelEdit(input);
  if(operation==='library-labels')validatePdfLabelQuery(input);
  if(!await this.available()){
   if(operation==='library-labels')return {items:[],next:null};
   if(!edit||input.operation.type!=='create')throw new AppError('NOT_FOUND');
   await this.domains.initialize(['pdf']);
  }
  // Project the reviewed publications in a read snapshot. The document writer
  // only compares current heads and source pins and enqueues the reviewed jobs.
  let prepared;
  if(batch&&input?.review?.action==='export'){
   prepared=new Map();
   const previous=await this.domains.run(['pdf'],async get=>{
    const owner=new PdfDocumentStore(get('pdf')),organization=new PdfLibraryOrganization(owner,(await owner.directory()).library);
    const {result}=await organization.receipt(input);if(result)return result;
    const review=await organization.review(input.review,{...options,publicationFiles:this.publicationFiles,collect:prepared});
    if(review.token!==input.token||review.items.some(item=>item.state!=='ready'))throw new AppError('CONFLICT');
   },options);
   if(previous)return previous;
  }
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf'),owner=new PdfDocumentStore(store);let {library}=await owner.directory();
   if(!library&&edit&&(await owner.prepareLibrary(options)).ready)({library}=await owner.directory());
   const organization=new PdfLibraryOrganization(owner,library),scoped={...options,publicationFiles:this.publicationFiles};
   if(edit)return organization.edit(input,scoped);
   if(operation==='library-labels')return organization.labels(input,scoped);
   if(!library||library.backfill)throw new AppError('CONFLICT');
   if(!batch)return organization.review(input,scoped);
   return organization.apply(input,{...scoped,prepared,queue:async item=>{
    const job=await queuePdfExport(store,{jobId:randomUUID(),documentId:item.id,revision:item.revision},{reviewedSources:item.sources});
    return job.id;
   }});
  },{...options,...(edit||batch?{write:['pdf']}:{})});
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
  const apply=async(store,extra={})=>{
   const owner=new PdfDocumentStore(store);
   if(['create','template-create'].includes(operation.type)&&!await store.object('pdf:directory'))await owner.prepareLibrary(options);
   return owner.change(command,{...options,...extra,publicationFiles:this.publicationFiles});
  };
  const custom=ids.filter(customFontId);if(!custom.length)return this.domains.run(['pdf'],get=>apply(get('pdf')),{...options,write:['pdf']});
  const prior=await this.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),receipt=await store.object('pdf:command:'+command.id+':'+command.commandId);if(receipt)return {replay:true};return {fonts:command.expectedRevision?(await owner.open(command.id,{revision:command.expectedRevision})).header.fonts??[]:[]};},options);
  const prepared=[];
  if(!prior.replay)for(const id of custom){if(prior.fonts.some(pin=>pin.id===id))continue;const captured=options.preparedFonts?.get(id);if(options.preparedFonts&&!captured)throw new AppError('PDF_FONT',[id]);prepared.push(captured??await preparePdfFont(this.storage,id,options));}
  return this.domains.run(['pdf'],async get=>{
   const store=get('pdf'),owner=new PdfDocumentStore(store),fontPins=(prior.fonts??[]).filter(pin=>custom.includes(pin.id));for(const value of prepared)fontPins.push(await retainPdfDocumentFont(store,command.id,value,options));
   const result=await apply(store,{fontPins});return {...result,fonts:(await owner.revision(command.id,result.revision)).header.fonts??[]};
  },{...options,write:['pdf']});
 }
}
