// A prepared edition takes page labels and one immutable page at a time.
// Navigation and media descriptions remain metadata; no page body joins them.
import {WEBSITE_COLLECTION_PATHS} from './web/website-collection-model.js';
export async function websitePublicationMetadata(projected,{signal}={}){
 const metadata={...projected.metadata,website:{...projected.metadata.website}};
 for(const collection of ['navigation','assets']){
  const path=WEBSITE_COLLECTION_PATHS[collection],items=[],count=await projected.document.tree.arrayLength(projected.document.root,path);
  for(let position=0;position<count;position++){signal?.throwIfAborted();items.push((await projected.document.field([...path,String(position)],{signal})).value);}
  metadata.website[collection]=items;
 }
 return metadata;
}
export async function* websitePublicationPages(projected,{signal}={}){
 for(const [position,page] of projected.metadata.pages.entries()){
  signal?.throwIfAborted();if(!page.share)continue;
  yield (await projected.document.field([...WEBSITE_COLLECTION_PATHS.pages,String(position)],{signal})).value;
 }
}

export async function websitePublicationPresentation(projected,{signal}={}){
 const streams={};
 for(const collection of ['layouts','branding']){
  const path=WEBSITE_COLLECTION_PATHS[collection],count=await projected.document.tree.arrayLength(projected.document.root,path);
  async function* items(){for(let position=0;position<count;position++){signal?.throwIfAborted();yield (await projected.document.field([...path,String(position)],{signal})).value;}}
  streams[collection]={count,items:items()};
 }
 return streams;
}
