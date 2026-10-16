import {profileById,availableSections,laboratoryModuleId} from './laboratory/catalog.js';
import {configurationOf} from './notebook-schema.js';
import {enabledModule} from './feature-modules.js';
import {RECORD_TYPES} from './record-types.js';

// Subject histories use ordinary record relationships and saved record identities.
// A profile can suggest actions without owning records or their persistence.
export function activityContext(book,record){
 const notebook=book.notebooks.find(n=>n.id===record?.notebookId),configuration=configurationOf(notebook);
 const section=configuration.sections.find(s=>s.id===record?.template?.id),profile=profileById(record?.template?.profileId);
 const tracking=profile?.tracking;
 return {notebook,section,tracking,subject:!!tracking?.subjects.includes(section?.key),event:!!tracking?.events.includes(section?.key)};
}
export function activityTemplates(book,record,settings){
 const {notebook}=activityContext(book,record);
 return availableSections(configurationOf(notebook)).filter(s=>!s.profileId||enabledModule(settings,laboratoryModuleId(s.profileId)));
}
export function activitySubjects(book,record){
 return book.entries.filter(e=>e.id!==record.id&&activityContext(book,e).subject);
}
export function documentRecord(workspaceId,record,subject){
 if(!subject||subject.id===record.id)throw Error('Choose another saved record.');
 if(record.relations.some(l=>l.type==='Documents'&&l.target.workspaceId===workspaceId&&l.target.kind==='record'&&l.target.id===subject.id&&!l.target.revision))return false;
 record.relations.push({id:crypto.randomUUID(),type:'Documents',label:subject.title,target:{workspaceId,kind:'record',id:subject.id}});
 return true;
}
export function activityChoices(book,record,settings){
 return [...activityTemplates(book,record,settings).map(section=>({value:'template:'+section.id,label:section.label,section,type:'note'})),
  ...RECORD_TYPES.map(t=>({value:'type:'+t.id,label:t.label,type:t.id,section:null}))];
}
