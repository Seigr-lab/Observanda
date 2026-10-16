import {validEditionSelection} from './publication-selection.js';
import {researchId} from './research-reference.js';
import {validWebsiteSelection} from './website-selection.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
// A website holds publication consent, not another owner's research metadata.
// Every source starts private and remains addressed by its stable namespace.
export function validPublicationSources(value){
 return Array.isArray(value)&&value.length<=100&&new Set(value.map(row=>row?.workspaceId)).size===value.length&&value.every(row=>exact(row,['workspaceId','projectIds','selection',...(row?.edition!==undefined?['edition']:[])])&&(row.edition===undefined||validEditionSelection(row.edition))&&researchId(row.workspaceId)&&Array.isArray(row.projectIds)&&row.projectIds.length<=100&&row.projectIds.every(researchId)&&new Set(row.projectIds).size===row.projectIds.length&&validWebsiteSelection(row.selection)&&row.selection.defaultShare===false&&row.selection.includeProjects.every(id=>row.projectIds.includes(id)))&&value.reduce((sum,row)=>sum+row.selection.records.length,0)<=1000&&value.reduce((sum,row)=>sum+(row.edition?.records.length??0)+(row.edition?.history?.length??0)+(row.edition?.availability?.length??0),0)<=10000;
}
export const emptyPublicationSource=workspaceId=>({workspaceId,projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}});
export function publicationSourceMetadata(metadata,source){
 if(!validPublicationSources([source])||metadata.id!==source.workspaceId||source.projectIds.some(id=>!metadata.projects.some(project=>project.id===id)))throw new TypeError('Invalid publication source');
 const selected=new Set(source.projectIds);
 return {...metadata,projects:metadata.projects.map(project=>({...project,share:selected.has(project.id)}))};
}
