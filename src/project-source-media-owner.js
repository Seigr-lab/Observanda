import {MediaImports} from './media-imports.js';
import {MediaStore} from './media.js';
import {projectSourceDeclaredOwner} from './project-source-declared-owner.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('MEDIA_INVALID');};
export function projectSourceMediaOwner(store,inventory,{signal}={}){
 const workspace=store.workspace,imports=new MediaImports(workspace),media=new MediaStore(workspace),declared=projectSourceDeclaredOwner(store,inventory.namespaceId,{signal});
 async function owner(id,asset=false){
  const prepared=asset||await store.object('metadata:.observanda/media-assets/'+id+'.json')!==null;
  let assetOwner=null,importOwner=null;
  if(prepared){const {metadata}=await media.metadata(id);assetOwner=await declared('media',id);if(!metadata.storageId)return assetOwner;}
  const session=await imports.read(id);if(session.workspaceId!==inventory.namespaceId)damaged();importOwner=await declared('mediaImport',id,{required:!assetOwner});
  if(importOwner&&assetOwner&&serialize(importOwner)!==serialize(assetOwner))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return importOwner??assetOwner;
 }
 return async id=>{
  if(!/^metadata:\.observanda\/media-(?:assets|imports)(?:[/-])/.test(id))return null;
  return workspace.inspectCatalogue(store,async()=>{
   signal?.throwIfAborted();let match;
   if((match=/^metadata:\.observanda\/media-assets\/([a-f0-9-]{36})\.json$/.exec(id)))return owner(match[1],true);
   if((match=/^metadata:\.observanda\/media-imports\/([a-f0-9-]{36})\.json$/.exec(id)))return owner(match[1]);
   if(id==='metadata:'+imports.feed.marker){if(!await imports.feed.initialized())damaged();return {kind:'derived'};}
   if((match=/^metadata:\.observanda\/media-imports-order\/\d{13}-([a-f0-9-]{36})\.json$/.exec(id))){const session=await imports.read(match[1]),raw=await workspace.readMetadata(id.slice(9),4096);let pointer;try{pointer=JSON.parse(raw);}catch{damaged();}if(pointer?.id!==session.id||pointer.createdAt!==session.createdAt||id!=='metadata:'+imports.feed.order+'/'+imports.feed.key(session))damaged();return owner(match[1]);}
   return null;
  });
 };
}
