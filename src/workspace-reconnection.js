import {catalogueBinding} from './postgres-activation.js';
import path from 'node:path';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
import {readPreferences,rememberLocation,rememberCatalogueIdentity} from './preferences.js';

export async function rememberAuthenticatedLocation(file,root){
 if(!file||!root)return;
 const saved=(await readPreferences(file)).recent.find(item=>item.path===root);
 if(!saved)return;
 const binding=await catalogueBinding(root);
 if(binding&&saved.catalogueId!==binding.id)await rememberCatalogueIdentity(file,root,binding.id);
}

// The catalogue identity survives a folder rename. A portable copy receives a
// new catalogue identity on activation and must not inherit local credentials.
export async function rememberWorkspaceLocation(file,root,details,{github,movingFrom}={}){
 const catalogueId=(await catalogueBinding(root))?.id;
 const replacedPaths=movingFrom?[movingFrom]:[];
 if(file&&catalogueId){
  for(const item of (await readPreferences(file)).recent){
   if(item.path===root||item.path===movingFrom||item.catalogueId!==catalogueId)continue;
   // Permission errors and disconnected mounts are not proof of a moved folder.
   let missing=false;const same=path.relative(item.path,root)==='';
   try{missing=!await assertRegular(item.path,{directory:true,missing:true});}catch{continue;}
   // A folder with a retired binding cannot be a linked copy of a current one.
   if(!same&&!missing&&(await catalogueBinding(item.path).catch(error=>{if(error.code==='CATALOGUE_BINDING_RETIRED')return null;throw error;}))?.id===catalogueId)throw new AppError('STORAGE_LINKED_COPY');
   if(missing||same)replacedPaths.push(item.path);
  }
 }
 for(const previous of replacedPaths)await github?.relocate(previous,root);
 const saved={...details,...(catalogueId?{catalogueId}:{})};
 await rememberLocation(file,root,saved,{replacedPaths});
 return {path:root,...saved};
}
