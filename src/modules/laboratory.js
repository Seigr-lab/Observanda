import {exact,text,uuid,prose,linksValid,linkCheck,requireValue,unique,saved} from './validation.js';
import {schemaValid,validateValues} from './fields.js';
import {laboratoryConstraintTypes,validateLaboratorySource} from './laboratory-constraints.js';
const key=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(v);
const sectionValid=s=>exact(s,['id','profileId','key','label','description','enabled','fields'])&&uuid(s.id)&&(s.profileId===null||key(s.profileId))&&key(s.key)&&text(s.label,160,true)&&text(s.description,2000)&&typeof s.enabled==='boolean'&&schemaValid(s.fields);
const snapshotValid=s=>exact(s,['label','description','fields'])&&text(s.label,160,true)&&text(s.description,2000)&&schemaValid(s.fields);
export function validateLabSpace(d){
 requireValue(exact(d,['name','description','archived','profiles','sections','links',...(Object.hasOwn(d??{},'scope')?['scope']:[])])&&text(d.name,240,true)&&prose(d.description,100000)&&typeof d.archived==='boolean'&&linksValid(d.links),'Lab space details');
 if(d.scope!==undefined)requireValue(exact(d.scope,['projectIds','notebookIds'])&&[d.scope.projectIds,d.scope.notebookIds].every(ids=>Array.isArray(ids)&&ids.every(uuid)&&unique(ids)),'Lab book scope');
 requireValue(Array.isArray(d.profiles)&&d.profiles.every(p=>exact(p,['id','version','enabled'])&&key(p.id)&&Number.isSafeInteger(p.version)&&p.version>0&&typeof p.enabled==='boolean')&&unique(d.profiles.map(p=>p.id)),'Lab submodules');
 requireValue(Array.isArray(d.sections)&&d.sections.every(sectionValid)&&unique(d.sections.map(s=>s.id))&&unique(d.sections.map(s=>(s.profileId??'custom')+':'+s.key))&&d.sections.every(s=>s.profileId===null||d.profiles.some(p=>p.id===s.profileId)),'Lab sections');
}
export function validateLabEntry(d){
 requireValue(exact(d,['title','labId','sectionId','schemaRevision','sectionSchema','notes','values','contributors','links'])&&text(d.title,240,true)&&uuid(d.labId)&&uuid(d.sectionId)&&Number.isSafeInteger(d.schemaRevision)&&d.schemaRevision>0&&snapshotValid(d.sectionSchema)&&prose(d.notes,100000)&&linksValid(d.links),'Lab record details');
 requireValue(Array.isArray(d.contributors)&&d.contributors.every(c=>exact(c,['id','name','role'])&&uuid(c.id)&&text(c.name,160,true)&&text(c.role,160))&&unique(d.contributors.map(c=>c.id)),'Contributors');
 validateValues(d.sectionSchema.fields,d.values);
}
export const laboratoryDefinitions={
 types:{'lab-space':validateLabSpace,'lab-entry':validateLabEntry},
 constraintTypes:laboratoryConstraintTypes,validateSource:validateLaboratorySource,
 validate:[entities=>{
  const assigned=new Set();
  for(const lab of entities.filter(e=>e.type==='lab-space'))for(const id of lab.data.scope?.notebookIds??[]){requireValue(!assigned.has(id),'A lab book can belong to only one lab space');assigned.add(id);}
  for(const e of entities.filter(e=>e.type==='lab-entry')){
   const lab=entities.find(l=>l.id===e.data.labId&&l.type==='lab-space');
   requireValue(lab?.data.sections.some(s=>s.id===e.data.sectionId),'Lab record section');
  }
 }],
 commands:{
  async 'lab-space.save'(tx,p){
   const old=saved(tx,p,'lab-space');validateLabSpace(p.data);await linkCheck(tx,p.data.links,old?.data.links);
   const scope=p.data.scope??{projectIds:[],notebookIds:[]},previous=old?.data.scope??{projectIds:[],notebookIds:[]};
   for(const id of scope.projectIds)requireValue(tx.book.projects.some(project=>project.id===id)||previous.projectIds.includes(id),'Project is no longer available','MODULE_REFERENCE');
   for(const id of scope.notebookIds){
    const notebook=tx.book.notebooks.find(n=>n.id===id);
    requireValue(notebook?scope.projectIds.includes(notebook.projectId):previous.notebookIds.includes(id),'Included notes must belong to an assigned project','MODULE_REFERENCE');
   }
   // Keep identities, including disabled sections, so existing records remain addressable.
   for(const section of old?.data.sections??[]){
    const next=p.data.sections.find(s=>s.id===section.id);
    requireValue(next&&next.profileId===section.profileId&&next.key===section.key,'Hide a section instead of deleting its identity');
   }
   tx.put('lab-space',p.id,p.data);
  },
  async 'lab-entry.save'(tx,p){
   const old=saved(tx,p,'lab-entry'),d=p.data;validateLabEntry(d);await linkCheck(tx,d.links,old?.data.links);
   const lab=tx.get(d.labId),section=lab?.data.sections?.find(s=>s.id===d.sectionId);
   requireValue(lab?.type==='lab-space'&&section,'Lab section','MODULE_REFERENCE');
   if(old){
    requireValue(d.labId===old.data.labId&&d.sectionId===old.data.sectionId&&d.schemaRevision===old.data.schemaRevision&&JSON.stringify(d.sectionSchema)===JSON.stringify(old.data.sectionSchema),'Saved lab record structure');
   }else{
    requireValue(!lab.data.archived&&section.enabled&&(!section.profileId||lab.data.profiles.some(p=>p.id===section.profileId&&p.enabled)),'Enable this lab section before adding records','MODULE_REFERENCE');
    requireValue(lab.revision===d.schemaRevision&&JSON.stringify(d.sectionSchema)===JSON.stringify({label:section.label,description:section.description,fields:section.fields}),'Lab configuration changed. Open a new record with the current section fields.','MODULE_CHANGED');
   }
   tx.put('lab-entry',p.id,d);
  }
 }
};
