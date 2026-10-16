import {validEditionSelection} from './publication-selection.js';
import {researchId} from './research-reference.js';
import {validWebsiteSelection} from './website-selection.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
// A website holds publication consent, not another owner's research metadata.
// Every source starts private and remains addressed by its stable namespace.
export function validPublicationSources(value){
 return Array.isArray(value)&&value.length<=100&&new Set(value.map(row=>row?.workspaceId)).size===value.length&&value.every(row=>exact(row,['workspaceId','projectIds','selection',...(row?.edition!==undefined?['edition']:[]),...(row?.labBookId!==undefined?['labBookId']:[])])&&(row.edition===undefined||validEditionSelection(row.edition))&&researchId(row.workspaceId)&&(row.labBookId===undefined||researchId(row.labBookId)&&row.projectIds?.length<=1)&&Array.isArray(row.projectIds)&&row.projectIds.length<=100&&row.projectIds.every(researchId)&&new Set(row.projectIds).size===row.projectIds.length&&validWebsiteSelection(row.selection)&&row.selection.defaultShare===false&&row.selection.includeProjects.every(id=>row.projectIds.includes(id)))&&value.reduce((sum,row)=>sum+row.selection.records.length,0)<=1000&&value.reduce((sum,row)=>sum+(row.edition?.records.length??0)+(row.edition?.history?.length??0)+(row.edition?.availability?.length??0),0)<=10000;
}
export const emptyPublicationSource=(workspaceId,labBookId=null)=>({workspaceId,...(labBookId?{labBookId}:{}),projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}});
// Dedicated book consent follows the stable book namespace. Its parent project
// is presentation context and may change without admitting sibling books.
export function resolvePublicationSource(metadata,source,owner={}){
 if(!validPublicationSources([source])||metadata.id!==source.workspaceId)throw new TypeError('Invalid publication source');
 if(source.labBookId!==undefined){
  const book=metadata.notebooks?.[0],project=metadata.projects[0];
  if(owner.labBookId!==source.labBookId||metadata.notebooks.length!==1||book.id!==source.labBookId||metadata.projects.length!==1||book.projectId!==project.id)throw new TypeError('Invalid publication source');
  return {...source,projectIds:source.projectIds.length?[project.id]:[],selection:{...source.selection,includeProjects:source.selection.includeProjects.length?[project.id]:[]}};
 }
 if(source.projectIds.some(id=>!metadata.projects.some(project=>project.id===id)))throw new TypeError('Invalid publication source');
 return source;
}
export function publicationSourceContext(metadata,source,owner={}){
 const resolved=resolvePublicationSource(metadata,source,owner),selected=new Set(resolved.projectIds);
 return {source:resolved,metadata:{...metadata,projects:metadata.projects.map(project=>({...project,share:selected.has(project.id)}))}};
}
export const publicationSourceMetadata=(metadata,source,owner={})=>publicationSourceContext(metadata,source,owner).metadata;
