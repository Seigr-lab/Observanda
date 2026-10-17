import {validateConfigurationChanges} from './configuration-metadata.js';
// Validate presentation identities and exact record targets through the
// authenticated catalogue. Each project website has its own target scope.
import {SnapshotIndex} from './snapshot-index.js';
import {validateCatalogueMetadata} from './model.js';
import {websiteBook,validWebsites} from './web/website-sites-model.js';
import {AppError} from './errors.js';
const values=value=>Array.isArray(value)?value:[];
const identifier=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const identities=book=>[book.id,...['projects','notebooks','pages','themes'].flatMap(key=>values(book[key]).map(v=>v?.id))];
export async function validateIndexedMetadata(store,current,metadata,{removed=[],records=[]}={}){
 const excluded=new Set([...removed,...records.map(r=>r.id)]),deleted=new Set(removed),added=new Map(records.map(r=>[r.id,r])),index=new SnapshotIndex(store);
 async function context(before,book){
  const known=new Set(identities(before)),reservedIds=[],entryTargets=[],notebooks=new Set(values(book.notebooks).map(n=>n.id));
  for(const id of identities(book))if(identifier(id)&&!known.has(id)){
   const collision=current.indexVersion?await index.member(await index.find({root:current.membership},'identity:'+id)):current.records.find(row=>row.id===id||row.sections.includes(id));
   if(collision&&!excluded.has(collision.id))reservedIds.push(id);
  }
  const targets=new Set([...values(book.branding),...values(book.website?.layouts)].map(v=>v?.target).filter(t=>typeof t==='string'&&t.startsWith('entry:')));
  for(const target of targets){
   const id=target.slice(6);if(!identifier(id)||deleted.has(id))continue;
   const row=added.get(id)??await store.member(current,id);
   if(row){const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;if(notebooks.has(notebookId))entryTargets.push(target);}
  }
  return {reservedIds,entryTargets};
 }
 const root=await context(current.metadata,metadata),websiteContexts=new Map();
 if(metadata.websites!==undefined){
  if(!validWebsites(metadata.websites,metadata))throw new AppError('INVALID');
  for(const site of metadata.websites){
   const previous=current.metadata.websites?.find(value=>value.id===site.id),before=previous?websiteBook(current.metadata,previous):{...current.metadata,pages:[],themes:[]};
   websiteContexts.set(site.id,await context(before,websiteBook(metadata,site)));
  }
 }
 const result=validateCatalogueMetadata(metadata,{...root,websiteContexts});
 await validateConfigurationChanges(store,current.metadata,metadata);return result;
}
