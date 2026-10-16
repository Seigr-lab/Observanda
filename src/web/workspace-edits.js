// The authoring editor submits only changed presentation metadata and records.
// Hierarchy and lab-book configuration keep their dedicated commands.
export const WORKSPACE_EDIT_FIELDS=['title','description','identity','appearance','website','pages','branding','themes','activeThemeId'];
import {sameValue as equal} from './workspace-snapshot.js';
export function workspaceSaveRequest(before,after,revisions){
 if(!before||before.id!==after.id||before.formatVersion!==21||after.formatVersion!==21)return null;
 const metadata={};
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(['entries','projects'].includes(key)||equal(before[key],after[key]))continue;
  if(!WORKSPACE_EDIT_FIELDS.includes(key)||after[key]===undefined)return null;
  metadata[key]=after[key];
 }
 if(before.projects.length!==after.projects.length)return null;
 const projects=[];
 for(let i=0;i<before.projects.length;i++){
  const previous=before.projects[i],next=after.projects[i];
  const {share,logoId,...rest}=next,{share:oldShare,logoId:oldLogo,...oldRest}=previous;
  if(!equal(rest,oldRest))return null;
  if(share!==oldShare||logoId!==oldLogo)projects.push({id:next.id,share,logoId});
 }
 const previous=new Map(before.entries.map(r=>[r.id,r])),next=new Set(after.entries.map(r=>r.id));
 // Existing record order is not an editable presentation setting.
 const kept=before.entries.filter(r=>next.has(r.id)).map(r=>r.id);
 if(!equal(after.entries.filter(r=>previous.has(r.id)).map(r=>r.id),kept))return null;
 const changes=after.entries.filter(r=>!equal(r,previous.get(r.id))).map(record=>({id:record.id,expectedRevision:revisions[record.id]??(previous.has(record.id)?undefined:null),record}));
 const removed=before.entries.filter(r=>!next.has(r.id)).map(r=>({id:r.id,expectedRevision:revisions[r.id]}));
 if([...changes,...removed].some(c=>c.expectedRevision===undefined))return null;
 return {workspaceId:after.id,metadata,projects,changes,removed};
}
