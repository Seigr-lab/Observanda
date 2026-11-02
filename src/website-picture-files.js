import {AppError} from './errors.js';

// Authored pictures are tracked separately from revocable research assets.
// Edits to one page read only reference lists from the manifest, including
// references in the saved stylesheets. Removing the last use retires the blob.
export function publicPictureNames(manifest){
 return new Set([...manifest.pages.filter(p=>!p.draft).flatMap(p=>p.pictures??[]),...(manifest.pictureStyles?.[manifest.cssPath]??[])]);
}
export async function saveWebsitePictures(store,manifest,{files,pages,style,htmlPictures,cssPictures,receivePictures,draft,signal}){
 const styles={...manifest.pictureStyles,[style]:[...cssPictures]};
 const used=new Set([...pages.flatMap(p=>p.pictures??[]),...Object.values(styles).flat()]);
 const known=new Map(files.filter(f=>f.name.startsWith('pictures/')).map(f=>[f.name,f]));
 const referenced=new Set([...htmlPictures,...cssPictures]);
 const added=[],priorBlobs=new Set(manifest.files.map(file=>file.blob));
 const rollback=async()=>{for(const blob of new Set(added.map(f=>f.blob)))if(!priorBlobs.has(blob))await store.remove(blob);};
 try{
  if(receivePictures)for await(const {name,bytes} of receivePictures()){
   if(known.has(name)||!referenced.has(name))throw new AppError('INVALID');
   const file={...await store.siteFile(manifest.id,name,bytes,{signal,draft}),picture:true};known.set(name,file);added.push(file);
  }
  for(const name of referenced){
   const file=known.get(name);
   if(!file||file.draft&&!draft)throw new AppError('INVALID');
  }
  return {files:[...files,...added].filter(f=>!f.picture||used.has(f.name)),pictureStyles:styles,rollback};
 }catch(error){await rollback();throw error;}
}
