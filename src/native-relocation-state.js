// Receipt validation is independent of owner storage constructors.
import {NativePortabilityCollection,portabilityCollection,validPortabilityCollection} from './portability-collection.js';
import {validPlacementIdentity} from './project-placement-transfer-state.js';
import {validDatabaseRetention} from './workspace-database-retention.js';
import {validateStorageName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function nativeRelocationOwners(registry,value){return portabilityCollection(registry.workspace,value.owners);}
export function validNativeRelocation(value){
 return value.ownerDirectoryVersion===2&&validPortabilityCollection(value.owners)&&validPortabilityCollection(value.ownerKeys)&&value.owners.id!==value.ownerKeys.id&&hash(value.projectRegistryRevision)&&['preparing','prepared','frozen','copying','moved','registered','retiring','retired','departing','departed','complete','cancelling','cancelled'].includes(value.phase)&&(value.phase==='preparing'||value.phase==='cancelled'&&value.keysReleased===true&&value.owners.count===0&&value.ownerKeys.count===0||value.owners.count>=1&&value.ownerKeys.count===value.owners.count-1)&&(value.keysReleased===undefined||value.keysReleased===true&&['departed','complete','cancelled'].includes(value.phase))&&(value.copied===undefined||value.copied===true);
}
export function validNativeRelocationOwner(item){
 const common=['kind','relative','projectId','namespaceId','vaultId','identity','accessHash','descriptorHash','sourceId'];
 if(!item||!['project','lab-book'].includes(item.kind)||![item.projectId,item.namespaceId,item.vaultId,item.sourceId].every(researchId)||!validPlacementIdentity(item.identity)||!hash(item.accessHash)||!hash(item.descriptorHash)||typeof item.relative!=='string'||item.relative.length>16384||/[\\:\u0000]/.test(item.relative))return false;
 const fields=[...common,...(item.kind==='project'?['parentId','summary','bookRevision']:['labBookId']),...(item.destinationId===undefined?[]:['destinationId','destinationIdentity','retention'])];
 if(Object.keys(item).sort().join()!==fields.sort().join())return false;
 if(item.kind==='lab-book'&&!researchId(item.labBookId)||item.kind==='project'&&(!hash(item.bookRevision)||item.parentId!==null&&!researchId(item.parentId)))return false;
 if(item.kind==='project'&&item.summary!==null){const summary=item.summary;if(!summary||Object.keys(summary).sort().join()!=='description,kind,templateName,title'||!['title','description','kind'].every(key=>typeof summary[key]==='string'&&summary[key].length<=({title:160,description:1500,kind:80})[key])||summary.templateName!==null&&(typeof summary.templateName!=='string'||summary.templateName.length>160))return false;}
 if(item.destinationId!==undefined&&(!researchId(item.destinationId)||item.destinationId===item.sourceId||!validPlacementIdentity(item.destinationIdentity)||!validDatabaseRetention(item.retention)))return false;
 const parts=item.relative?item.relative.split('/'):[];if(parts.length>128)return false;try{for(const part of parts){validateStorageName(part);if(part.toLowerCase()==='.observanda')return false;}}catch{return false;}
 return true;
}
export async function verifyNativeRelocationOwners(registry,value){
 if(!validNativeRelocation(value)||value.phase==='preparing')throw new AppError('STORAGE_RENAME_STATE');
 await registry.workspace.catalogue(async store=>{const native=new NativePortabilityCollection(store,value.owners.id);await native.checked(value.owners);await native.verify(value.owners);let root=false,ordinal=0;
 const owners={find:(index,key)=>native.find(value.owners,index,key),async *entries(){let offset=0;do{const page=await native.page(value.owners,{offset});yield* page.items;offset=page.next;}while(offset!==null);}};
 for await(const item of owners.entries()){
  if(!validNativeRelocationOwner(item)||!value.copied&&item.destinationId!==undefined||value.copied&&value.phase!=='copying'&&item.destinationId===undefined)throw new AppError('STORAGE_RENAME_STATE');
  const parts=item.relative?item.relative.split('/'):[];if(parts.length>128)throw new AppError('STORAGE_RENAME_STATE');for(const part of parts)validateStorageName(part);
  if(!parts.length){if(root||ordinal!==0||item.kind!=='project'||['projectId','namespaceId','vaultId','parentId'].some(key=>item[key]!==value[key]))throw new AppError('STORAGE_RENAME_STATE');root=true;}
  else{const parent=await owners.find('project',item.kind==='project'?item.parentId:item.projectId);if(!parent||parent.relative!==parts.slice(0,-1).join('/'))throw new AppError('STORAGE_RENAME_STATE');const pointer=await native.index.find({root:value.owners.roots.project},parent.projectId);if(!pointer||(await native.row(pointer.revision)).ordinal>=ordinal)throw new AppError('STORAGE_RENAME_STATE');}
  if(item.kind==='project'&&!hash(item.bookRevision))throw new AppError('STORAGE_RENAME_STATE');ordinal++;
 }
 if(!root)throw new AppError('STORAGE_RENAME_STATE');});return nativeRelocationOwners(registry,value);
}
