// Retired media bytes keep a checked location in their independently owned project.
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {digest,serialize,assertRegular} from './storage.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {catalogueFormat} from './catalogue-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const mediaRetirementSlot=relative=>'project-source-media:'+digest(relative);
export const mediaOriginKey=(kind,id)=>'project:media-'+(kind==='asset'?'':'import-')+'origin:'+id;
export function projectMediaFiles(kind,metadata){
 if(!['asset','import'].includes(kind)||!researchId(metadata?.id))damaged();
 const files=[],add=(name,size,sha256)=>{if(!Number.isSafeInteger(size)||size<0||!revisionId(sha256))damaged();files.push({relative:'.observanda/media/'+metadata.id+'/'+name,size,sha256});};
 if(kind==='import'){if(metadata.source){if(!researchId(metadata.source.storageId))damaged();add(metadata.source.storageId+'.original',metadata.source.size,metadata.source.sha256);}}
 else{
  if(!['file','image','audio','video'].includes(metadata.kind)||metadata.storageId!==undefined&&!researchId(metadata.storageId))damaged();
  if(!metadata.storageId||metadata.kind==='file')add(metadata.storageId?metadata.storageId+'.original':'original',metadata.originalBytes,metadata.originalSha256);
  if(metadata.kind!=='file'){const extension={image:'png',audio:'wav',video:'mp4'}[metadata.kind];if(metadata.extension!==extension)damaged();add((metadata.storageId?metadata.storageId+'.':'')+'public.'+extension,metadata.bytes,metadata.sha256);}
 }
 return files;
}
export async function mediaFileStamp(root,relative,{missing=false}={}){
 const parts=relative.split('/');if(parts.length!==4||parts[0]!=='.observanda'||parts[1]!=='media'||!researchId(parts[2])||!(/^(original|public\.(png|wav|mp4))$/.test(parts[3])||/^[a-f0-9-]{36}\.(original|public\.(png|wav|mp4))$/.test(parts[3])&&researchId(parts[3].slice(0,36))))throw new AppError('UNSAFE');
 let file=root;await assertRegular(file,{directory:true});for(const part of parts.slice(0,-1)){file=path.join(file,part);await assertRegular(file,{directory:true});}file=path.join(file,parts.at(-1));let value;
 try{value=await lstat(file,{bigint:true});}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}if(!value.isFile()||value.nlink!==1n)throw new AppError('UNSAFE');
 return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(value[key])]));
}
export function validMediaRetirement(value){
 if(!value||Object.keys(value).sort().join()!=='file,kind,metadata,owner,phase,relative,sha256,size,version'||value.version!==1||!validProjectSourceAuthority(value.owner)||!['located','retired'].includes(value.phase)||!value.file||Object.keys(value.file).sort().join()!=='ctimeNs,dev,ino,mtimeNs,size'||!Object.values(value.file).every(n=>typeof n==='string'&&/^\d+$/.test(n)))return false;
 try{return projectMediaFiles(value.kind,value.metadata).some(file=>file.relative===value.relative&&file.size===value.size&&file.sha256===value.sha256);}catch{return false;}
}
export async function proveRetainedMediaFile(store,owner,kind,metadata,file){
 if(store.workspace.projectId!==owner.projectId||store.workspace.vault.id!==owner.vaultId||(await store.snapshot()).metadata.id!==owner.namespaceId)damaged();
 if(!projectMediaFiles(kind,metadata).some(item=>serialize(item)===serialize(file)))damaged();
 const origin=await store.object(mediaOriginKey(kind,metadata.id));
 if(origin?.version!==1||origin.id!==metadata.id||origin.projectId!==owner.projectId||origin.namespaceId!==owner.namespaceId||origin.sourceNamespace!==owner.sourceNamespace||origin.revision!==hash(metadata)||kind==='import'&&metadata.workspaceId!==owner.sourceNamespace)damaged();
}
export async function retiredMediaContent(workspace,relative,size,sha256){
 if(workspace.projectId||await workspace.storageKind()!=='catalogue')return null;
 const slot=mediaRetirementSlot(relative),value=await workspace.catalogue(async store=>{const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return null;if(await catalogueFormat(store.db)<23)damaged();return store.decode('state',slot,row.payload);});
 if(value===null)return null;if(!validMediaRetirement(value)||value.relative!==relative||value.size!==size||value.sha256!==sha256)damaged();
 const {OwnedFileContent}=await import('./owned-file-content.js'),{FileContent}=await import('./file-content.js');
 return new OwnedFileContent(workspace,path.join(workspace.root,...relative.split('/')),size,sha256,consume=>workspace.catalogue(store=>withRetiredProjectCatalogue(store,value.owner,{kind:'project',id:value.owner.projectId,domain:'research'},async selected=>{
  await proveRetainedMediaFile(selected,value.owner,value.kind,value.metadata,{relative,size,sha256});await mediaFileStamp(selected.workspace.root,relative);return consume(new FileContent(selected.workspace,path.join(selected.workspace.root,...relative.split('/')),size,sha256));
 })));
}
