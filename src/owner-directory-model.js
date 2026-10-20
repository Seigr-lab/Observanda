// Directory keys are deterministic across operating systems and ICU versions.
// Version 1 folds compatibility accents/case and compares digit runs by value;
// the immutable owner identity breaks equal-label ties. No locale comparator
// participates in persisted index ordering or authentication.
import path from 'node:path';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validTableRef} from './retained-table-index.js';
import {validateStorageName} from './storage-names.js';
import {encodeProjectRegistryLocations,decodeProjectRegistryLocations} from './project-registry-locations.js';
export const OWNER_DIRECTORY_PREFIX='owner-directory:';
export const OWNER_DIRECTORY_HEAD=OWNER_DIRECTORY_PREFIX+'head';
export const OWNER_DIRECTORY_INDEXES=['identity','namespace','vault','location','active','label','template','parent'];
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===fields.slice().sort().join();
const invalid=()=>{throw new AppError('FORMAT');};
export function ownerDirectorySortKey(label,id){
 if(typeof label!=='string'||!researchId(id))throw new AppError('INVALID');
 let key='';for(const part of label.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[0-9]+|[^0-9]/gu)??[]){
  if(/^[0-9]/.test(part)){const number=part.replace(/^0+(?=.)/,'');key+='1'+String(number.length).padStart(4,'0')+number+'0';}
  else key+='2'+part.codePointAt(0).toString(16).padStart(6,'0');
 }
 return key+'!'+id;
}
export const ownerDirectoryEntryId=(kind,entry)=>entry[kind==='projects'?'projectId':'labBookId'];
export const ownerDirectoryMarkerVersion=kind=>kind==='projects'?8:3;
export function ownerDirectoryMarker(kind,ownerId,receipt){return {version:ownerDirectoryMarkerVersion(kind),[kind==='projects'?'workspaceId':'projectId']:ownerId,ownerDirectory:{version:1,kind,receipt}};}
export function validOwnerDirectoryMarker(value,kind,ownerId){return exact(value,['version',kind==='projects'?'workspaceId':'projectId','ownerDirectory'])&&value.version===ownerDirectoryMarkerVersion(kind)&&value[kind==='projects'?'workspaceId':'projectId']===ownerId&&exact(value.ownerDirectory,['version','kind','receipt'])&&value.ownerDirectory.version===1&&value.ownerDirectory.kind===kind&&revisionId(value.ownerDirectory.receipt);}
const summary=value=>value===null||exact(value,['title','description','kind','templateName'])&&['title','description','kind'].every(key=>typeof value[key]==='string'&&value[key].length<=({title:160,description:1500,kind:80})[key])&&(value.templateName===null||typeof value.templateName==='string'&&value.templateName.length<=160);
export function ownerDirectoryRow(kind,state,entry,root,{stored=false}={}){
 if(!['projects','books'].includes(kind)||!['active','deleted','relocated'].includes(state))invalid();
 const id=kind==='projects'?'projectId':'labBookId',fields=[id,'namespaceId','vaultId'];
 if(state==='active')fields.push(...(kind==='projects'?['root','parentId','summary']:['directory']));else{fields.push('operationId');if(state==='relocated')fields.push(kind==='projects'?'workspaceId':'projectId');}
 if(!exact(entry,fields)||!fields.filter(key=>![id,'namespaceId','vaultId','operationId','workspaceId','projectId'].includes(key)?false:true).every(key=>researchId(entry[key])))invalid();
 let result=structuredClone(entry);
 if(state==='active'){
  if(kind==='projects'){
   if(!summary(entry.summary)||entry.parentId!==null&&!researchId(entry.parentId))invalid();
   const value={version:7,projects:[result]};result=(stored?decodeProjectRegistryLocations(value,root):value).projects[0];
   if(typeof result.root!=='string'||!path.isAbsolute(result.root)||path.resolve(result.root)!==result.root)invalid();
   if(!stored)result=encodeProjectRegistryLocations({version:7,projects:[result]},root).projects[0];
  }else{validateStorageName(entry.directory,{nameError:'FORMAT'});if(entry.directory.toLowerCase()==='.observanda')invalid();}
 }
 return {state,entry:result};
}
export function ownerDirectoryKeys(kind,row,{namePolicy='folded'}={}){
 const {state,entry}=row,id=ownerDirectoryEntryId(kind,entry),keys={identity:id,namespace:entry.namespaceId,vault:entry.vaultId};
 if(state!=='active')return keys;
 keys.active=id;
 if(kind==='projects'){
  keys.location=typeof entry.root==='string'?'absolute:'+entry.root:'relative:'+entry.root.relative;
  keys.label=ownerDirectorySortKey(entry.summary?.title??id,id);keys.parent=(entry.parentId??'root')+':'+ownerDirectorySortKey(entry.summary?.title??id,id);
  if(entry.summary?.templateName)keys.template=ownerDirectorySortKey(entry.summary.templateName,id);
 }else{keys.location=namePolicy==='folded'?entry.directory.normalize('NFC').toLowerCase():entry.directory;keys.label=ownerDirectorySortKey(entry.directory,id);}
 return keys;
}
export function validOwnerDirectoryHead(value){
 return exact(value,['version','kind','ownerId','namePolicy','receipt','aliases','roots'])&&value.version===1&&['projects','books'].includes(value.kind)&&researchId(value.ownerId)&&['exact','folded'].includes(value.namePolicy)&&exact(value.receipt,['legacyDigest','original'])&&(value.receipt.legacyDigest==='new'||revisionId(value.receipt.legacyDigest))&&validTableRef(value.receipt.original)&&validTableRef(value.aliases)&&exact(value.roots,OWNER_DIRECTORY_INDEXES)&&Object.values(value.roots).every(validTableRef);
}
