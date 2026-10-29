import {publicationSourceCount,publicationSourceRevision} from './publication-source-context.js';
import {websiteSnapshot} from './website-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';

// This cache belongs to the website view. Research originals and the saveable
// host document are never replaced by the combined canvas's display labels.
export function publicationEditorClient({state}){
 let context=null,consent=null,projection=null,selected=null;
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id]);
 const selection=()=>publicationSourceRevision(state);
 function close(){context=null;consent=null;projection=null;selected=null;}
 function sync(){const next=identity(),choices=selection();if(context!==next||consent!==choices){projection=null;selected=null;context=next;consent=choices;}if(state.access?.locked||state.storageUnavailable||state.page!=='website')close();}
 function accept(value){
  sync();if(value===undefined){projection=null;return;}
  const sources=state.book.website.researchSources??[],ids=new Set(sources.map(source=>source.workspaceId)),count=publicationSourceCount(state);
  const invalid=()=>{throw Error('PUBLICATION_EDITOR_RESPONSE');};
  if(value?.workspaceId!==state.book.id||value.recordCount!==null&&(!Number.isSafeInteger(value.recordCount)||value.recordCount<0)||!['sources','projects','notebooks','records'].every(key=>Array.isArray(value[key])))invalid();
  if(value.sources.length!==count||new Set(value.sources.map(source=>source.workspaceId)).size!==count||value.sources.some(source=>(state.websiteEditor?!researchId(source.workspaceId):!ids.has(source.workspaceId))||!revisionId(source.snapshotId)||![source.projectId,source.labBookId].every(id=>id===null||researchId(id))))invalid();
  for(const key of ['projects','notebooks','records'])if(new Set(value[key].map(item=>item.id)).size!==value[key].length||value[key].some(item=>!researchId(item.id)||typeof item.title!=='string'||item.title.length>(key==='records'?180:160)))invalid();
  if(value.notebooks.some(book=>!value.projects.some(project=>project.id===book.projectId))||value.records.some(record=>!value.notebooks.some(book=>book.id===record.notebookId)||!Array.isArray(record.attachments)||record.attachments.some(item=>!researchId(item.id)||!['image','audio','video','file'].includes(item.kind)||item.share!==true||typeof item.caption!=='string'||typeof item.alt!=='string')))invalid();
  for(const key of ['projects','notebooks'])if(value[key].some(item=>state.book[key].some(local=>local.id===item.id)))invalid();
  projection={recordCount:value.recordCount,sources:structuredClone(value.sources),projects:value.projects.map(({id,title,parentId})=>({id,title,parentId:parentId??null,share:true,logoId:null,description:''})),notebooks:value.notebooks.map(({id,title,projectId})=>({id,title,projectId})),records:value.records.map(({id,title,notebookId,type,attachments})=>({id,title,notebookId,type,share:true,attachments:attachments.map(({id,kind,caption,alt})=>({id,kind,caption,alt,share:true}))}))};
 }
 function remember(page){
  sync();if(!page||!(state.websiteEditor?researchId(page.owner?.workspaceId):state.book.website.researchSources?.some(source=>source.workspaceId===page.owner?.workspaceId))||page.target!=='entry:'+page.record?.id||!researchId(page.record.id)||typeof page.title!=='string')throw Error('PUBLICATION_EDITOR_RESPONSE');
  selected={id:page.record.id,title:page.title,notebookId:page.record.notebookId};
 }
 return {accept,remember,sync,close,
  sources(){sync();return projection?.sources??[];},
  recordCount(){sync();return projection?.recordCount??null;},
  record(id){sync();return projection?.records.find(record=>record.id===id)??null;},
  pageBook(book){sync();if(!projection&&!selected)return book;const entries=new Map(book.entries.map(record=>[record.id,record]));for(const record of projection?.records??[])entries.set(record.id,record);if(selected&&!entries.has(selected.id))entries.set(selected.id,selected);return {...book,projects:[...book.projects,...projection?.projects??[]],notebooks:[...book.notebooks,...projection?.notebooks??[]],entries:[...entries.values()]};}
 };
}
