import {localTaskDependency} from './web/task-prerequisite-model.js';
// Domain facts establish ownership. Links, stock locations and lab scopes do
// not turn a shared item into project-owned content.
import {moduleReferences} from './modules/references.js';
export function moduleOwnerFact(entity){
 const d=entity.data;
 if(['movement','reservation','stock-transfer','asset-transfer'].includes(entity.type))return {kind:'parent',type:'resource',id:d.resourceId};
 if(entity.type==='event')return {kind:'parent',type:'calendar',id:d.calendarId};
 if(entity.type==='lab-entry')return {kind:'parent',type:'lab-space',id:d.labId};
 if(Object.hasOwn(d,'projectId'))return d.projectId===null?{kind:'workspace'}:{kind:'project',projectId:d.projectId};
 if(entity.type==='booking')return {kind:'parent',type:'resource',id:d.resourceId};
 return {kind:'undeclared'};
}
export function* moduleMigrationDependencies(entity,namespaceId){
 const d=entity.data;
 const module=(type,id)=>({kind:'module',type,id});
 if(d.categoryId)yield module('category',d.categoryId);
 if(d.calendarId)yield module('calendar',d.calendarId);
 if(d.labId)yield module('lab-space',d.labId);
 if(d.resourceId)yield module('resource',d.resourceId);
 if(d.reservationId)yield module('reservation',d.reservationId);
 if(entity.type==='task')for(const dependency of d.dependencies){
  if(localTaskDependency(dependency,namespaceId))yield module('task',typeof dependency==='string'?dependency:dependency.id);
  else yield {kind:'external',...dependency};
 }
 if(entity.type==='bom'){
  yield {kind:'record',id:d.recordId};
  for(const line of d.lines){if(line.resourceId)yield module('resource',line.resourceId);if(line.sourceProjectId)yield {kind:'project',id:line.sourceProjectId};}
  for(const item of d.allocations)yield module('reservation',item.reservationId);
 }
 for(const key of ['projectId','fromProjectId','toProjectId','placementId'])if(d[key])yield {kind:'project',id:d[key]};
 if(entity.type==='lab-space'){
  for(const id of d.scope?.projectIds??[])yield {kind:'project',id};
  for(const id of d.scope?.notebookIds??[])yield {kind:'notebook',id};
 }
 if(entity.type==='timeline-view'){
  // Qualified sources are included by moduleReferences below.
  for(const id of d.projects)if(!id.includes('/'))yield {kind:'project',id};
  for(const id of d.books)if(!id.includes('/'))yield {kind:'notebook',id};
 }
 for(const ref of moduleReferences(entity).links){
  if(ref.workspaceId!==namespaceId)yield {kind:'external',...ref};
  else if(['project','notebook','record'].includes(ref.type))yield {kind:ref.type,id:ref.id};
  else yield module(ref.type,ref.id);
 }
}
