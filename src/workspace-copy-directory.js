// Copy receipts pin the existing native directory roots, not another registry
// envelope. Placement traversal uses encrypted scratch and bounded index pages.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {validOwnerDirectoryHead} from './owner-directory-model.js';
import {ProjectRegistry} from './project-registry.js';
import {NativeOwnerDirectory} from './owner-directory.js';
import {projectRegistryLocationKey,projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {withScratch} from './scratch-work.js';
import {validateStorageName} from './storage-names.js';
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const pathKey=value=>['win32','darwin'].includes(process.platform)?value.normalize('NFC').toLowerCase():value;
export function validWorkspaceCopyDirectory(value){return value&&Object.keys(value).sort().join()==='head,revision,version'&&value.version===1&&validOwnerDirectoryHead(value.head)&&value.head.kind==='projects'&&value.revision===digest(serialize(value.head));}
export function workspaceCopyTransferId(copyId,projectId){const bytes=createHash('sha256').update('Observanda/native-workspace-copy/v1\0').update(copyId).update('\0').update(projectId).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
export async function captureWorkspaceCopyDirectory(registry){
 let current=await registry.directoryOwner.access.read(value=>value.legacy?{legacy:true,revision:value.legacy.revision}:{version:1,head:value.value,revision:value.revision});
 if(current.legacy){await registry.apply(current.revision,[]);current=await registry.directoryOwner.access.read(value=>({version:1,head:value.value,revision:value.revision}));}
 if(!validWorkspaceCopyDirectory(current))throw new AppError('STORAGE_COPY');return current;
}
export async function withWorkspaceCopyDirectory(workspace,pin,operation){
 if(!validWorkspaceCopyDirectory(pin))throw new AppError('STORAGE_COPY');const registry=new ProjectRegistry(workspace,pin.head.ownerId);
 if(!await catalogueBinding(workspace.root)){const archive=path.join(workspace.root,CATALOGUE_ARCHIVE),sha256=await hashWorkspaceFile(archive,{reportProgress:false});return inspectArchivedOwnerDirectory(registry,sha256,operation,{pin:{head:pin.head,revision:pin.revision}});}
 return workspace.catalogue(async store=>{
  const envelope=await registry.directoryOwner.access.envelope();if(!envelope.marker||envelope.marker.ownerDirectory.receipt!==digest(serialize(pin.head.receipt)))throw new AppError('STORAGE_COPY');
  const directory=new NativeOwnerDirectory(store,{kind:'projects',ownerId:pin.head.ownerId});await directory.head({required:true});
  return operation({revision:pin.revision,count:pin.head.roots.active?.count??0,aliases:pin.head.aliases,native:true,
   get:(id,options)=>directory.find(pin.head,id,options),entries:options=>directory.rows(pin.head,{index:'active',...options}),page:options=>directory.page(pin.head,options)});
 });
}
export async function visitWorkspaceCopyPlacements(view,source,destination,visit,{signal}={}){
 if(!path.isAbsolute(source)||!path.isAbsolute(destination)||source===destination||inside(source,destination)||inside(destination,source))throw new AppError('STORAGE_PATH');
 return withScratch(async pending=>withScratch(async mapped=>{
  for await(const row of view.entries({index:'parent',prefix:'root:',signal}))if(!await pending.add(row.entry.projectId,row.entry))throw new AppError('STORAGE_PATH');
  let count=0,entry;while((entry=await pending.take())!==undefined){
   signal?.throwIfAborted();const name=validateStorageName(path.basename(entry.root),{nameError:'STORAGE_PATH'});if(['.observanda','observanda.json'].includes(pathKey(name))||entry.root===source||inside(entry.root,source))throw new AppError('STORAGE_PATH');
   const parent=entry.parentId===null?null:await mapped.get('owner:'+entry.parentId);if(entry.parentId!==null&&(!parent||path.dirname(entry.root)!==parent.source))throw new AppError('STORAGE_PATH');
   let physical=null;for(let root=path.dirname(entry.root);;root=path.dirname(root)){const row=await view.get(projectRegistryLocationKey(root,source),{index:'location'});if(row){physical=row.entry.projectId;break;}if(root===path.dirname(root))break;}if(physical!==entry.parentId)throw new AppError('STORAGE_PATH');
   const target=parent?path.join(parent.destination,name):inside(source,entry.root)?path.join(destination,path.relative(source,entry.root)):path.join(destination,name);
   if(!inside(destination,target)||path.relative(destination,target).split(path.sep)[0]==='.observanda'||await mapped.has('descendant:'+pathKey(target))||!await mapped.add('path:'+pathKey(target),entry.projectId))throw new AppError('STORAGE_PATH');
   // Check the target's nearest previously placed physical parent. Parent-first
   // traversal and unique target keys rule out undeclared destination nesting.
   let physicalTarget=null;for(let root=path.dirname(target);root!==destination;root=path.dirname(root)){const owner=await mapped.get('path:'+pathKey(root));if(owner){physicalTarget=owner;break;}if(root===path.dirname(root))throw new AppError('STORAGE_PATH');}if(physicalTarget!==entry.parentId)throw new AppError('STORAGE_PATH');
   for(let root=path.dirname(target);root!==destination;root=path.dirname(root))await mapped.add('descendant:'+pathKey(root));
   await mapped.put('owner:'+entry.projectId,{source:entry.root,destination:target});await visit({...entry,destination:target});count++;
   for await(const row of view.entries({index:'parent',prefix:entry.projectId+':',signal}))if(!await pending.add(row.entry.projectId,row.entry))throw new AppError('STORAGE_PATH');
  }
  if(count!==view.count)throw new AppError('STORAGE_PATH');return count;
 },{signal}),{signal});
}
export function workspaceCopyExclusion(view,source){return async root=>{if(!inside(source,root))return false;return (await view.get(projectRegistryLocationKey(root,source),{index:'location'}))?.state==='active';};}
export async function workspaceCopyChildRoots(view,source,root){const roots=[];for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(root,source)}))roots.push(entry.root);return roots;}
