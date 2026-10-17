// Native capture reads collection rows directly from the pinned website tree.
// Header placeholders do not stand for omitted collection contents.
import {WEBSITE_COLLECTION_PATHS} from './web/website-collection-model.js';
export async function websitePublicationMetadata(projected){
 const metadata={...projected.metadata,branding:[],pages:[],website:{...projected.metadata.website,navigation:[],assets:[],layouts:[],presentation:{...projected.metadata.website.presentation,media:[],covers:[]}}};
 return metadata;
}
export async function websitePublicationCollections(projected,{signal}={}){
 const streams={};
 for(const collection of ['pages','navigation','assets','layouts','branding','presentationMedia','covers']){
  const path=collection==='presentationMedia'?['document','website','presentation','media']:collection==='covers'?['document','website','presentation','covers']:WEBSITE_COLLECTION_PATHS[collection];
  const count=await projected.document.tree.arrayLength(projected.document.root,path);
  async function* items(){for(let position=0;position<count;position++){
   signal?.throwIfAborted();const selected=[...path,String(position)];
   if(collection==='pages')yield {id:(await projected.document.field([...selected,'id'],{signal})).value,title:(await projected.document.field([...selected,'title'],{signal})).value,share:(await projected.document.field([...selected,'share'],{signal})).value,body:'',sections:[]};
   else yield (await projected.document.field(selected,{signal})).value;
  }}
  streams[collection]={count,items:{[Symbol.asyncIterator]:items}};
 }
 return streams;
}
export async function* websitePublicationPages(projected,{signal}={}){
 const path=WEBSITE_COLLECTION_PATHS.pages,count=await projected.document.tree.arrayLength(projected.document.root,path);
 for(let position=0;position<count;position++){
  signal?.throwIfAborted();if(!(await projected.document.field([...path,String(position),'share'],{signal})).value)continue;
  yield (await projected.document.field([...path,String(position)],{signal})).value;
 }
}
// Compatibility callers can still request only presentation streams.
export async function websitePublicationPresentation(projected,options){const {layouts,branding}=await websitePublicationCollections(projected,options);return {layouts,branding};}
