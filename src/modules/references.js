import {timelineSource} from '../web/tools/timeline-source.js';
import {proseReferences} from '../web/prose-model.js';
// Authenticated reverse-link facts are separate from presentation summaries.
// Reading a record's connected work must not fetch spreadsheets or prose bodies.
export function moduleReferences(entity){
 const d=entity.data,links=new Map();
 for(const link of [...(d.links??[]),...Object.values(d).flatMap(proseReferences).map(r=>({workspaceId:r.workspaceId,type:r.kind,id:r.id}))])links.set(JSON.stringify([link.workspaceId,link.type,link.id]),link);
 if(entity.type==='timeline-view')for(const [type,values] of [['project',d.projects],['notebook',d.books]])for(const value of values)if(value.includes('/')){const ref=timelineSource(value,null),link={workspaceId:ref.workspaceId,type,id:ref.id};links.set(JSON.stringify([link.workspaceId,link.type,link.id]),link);}
 return {links:[...links.values()],projectId:d.projectId??null,
  ownerId:Object.hasOwn(d,'projectId')?null:d.calendarId??d.resourceId??null};
}
