import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {emptyPublicationLinks,validPublicationLinks} from './web/publication-links-model.js';
import {publicationLinkResolver} from './publication-prose.js';
import {researchReference} from './web/research-reference.js';
import {PUBLIC_INDEX_ROWS,publicIndexPage} from './web/public-browse-pages.js';
import {PUBLIC_COLLECTION_ROWS,collectionPageFromPath} from './web/public-collection-pages.js';
const file='.observanda/publication-links.json';

export class PublicationLinks{
 constructor(workspace){this.workspace=workspace;}
 async read(){const raw=await this.workspace.readMetadata(file,4*1024*1024),config=raw?JSON.parse(raw):emptyPublicationLinks();if(!validPublicationLinks(config))throw new AppError('CATALOGUE_DAMAGED');return {config,etag:raw?digest(raw):'new'};}
 async save({config,etag,workspaceId}){
  if(!validPublicationLinks(config)||Buffer.byteLength(serialize(config))>4*1024*1024)throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{if((await this.workspace.outline()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');if((await this.read()).etag!==etag)throw new AppError('CONFLICT');await this.workspace.writeMetadata(file,serialize(config));return this.read();});
 }
}
export function projectPublicationLinks(workspaceId,selection,config){
 if(!validPublicationLinks(config))throw new AppError('INVALID');
 const issues=[],resolve=publicationLinkResolver(workspaceId,selection),paths=new Set(),pages=[];
 const generated=new Set([...(selection.homeEnabled?['index.html']:[]),...(selection.entries.length?['browse.html']:[]),...['projects','notebooks','pages','entries'].flatMap(key=>selection[key].map(r=>key+'/'+r.id+'.html'))].map(p=>p.toLowerCase()));
 for(const p of config.pages){
  const canonical=p.path.toLowerCase(),fragments=new Set(),anchors=[];
  const indexPage=publicIndexPage(canonical);
  if(generated.has(canonical)||indexPage!==null&&indexPage<Math.ceil(selection.entries.length/PUBLIC_INDEX_ROWS))issues.push({path:p.path,reason:'generatedPath'});
  const collection=collectionPageFromPath(canonical);
  if(collection?.page){
   const [kind,id]=collection.target.split(':'),notebooks=new Set(kind==='notebook'?[id]:selection.notebooks.filter(n=>n.projectId===id).map(n=>n.id));
   const count=selection.entries.filter(r=>!r.historical&&notebooks.has(r.notebookId)).length;
   if(collection.page<Math.ceil(count/PUBLIC_COLLECTION_ROWS))issues.push({path:p.path,reason:'generatedPath'});
  }
  if(paths.has(canonical))issues.push({path:p.path,reason:'ambiguousPath'});paths.add(canonical);
  for(const a of p.anchors){
   if(fragments.has(a.fragment))issues.push({path:p.path,fragment:a.fragment,reason:'ambiguousFragment'});fragments.add(a.fragment);
   const href=a.target?resolve(researchReference(a.target)):null;
   if(!href)issues.push({path:p.path,fragment:a.fragment,reason:'unmappedTarget'});
   else anchors.push({fragment:a.fragment,label:a.label,href});
  }
  pages.push({id:p.id,path:p.path,title:p.title,anchors});
 }
 if(issues.length)throw new AppError('PUBLICATION_LINKS',issues.slice(0,100));
 return pages;
}
