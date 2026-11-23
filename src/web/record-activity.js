import {isConfigurationReference} from './configuration-reference.js';
import {profileById} from './laboratory/catalog.js';
import {configurationOf} from './notebook-schema.js';

// Subject histories use ordinary record relationships and saved record identities.
// A profile can suggest actions without owning records or their persistence.
export function activityContext(book,record,{selectedSection=null}={}){
 const notebook=book.notebooks.find(n=>n.id===record?.notebookId),configuration=configurationOf(notebook);
 const section=selectedSection??(isConfigurationReference(configuration)?null:configuration.sections.find(s=>s.id===record?.template?.id)),profile=profileById(record?.template?.profileId);
 const tracking=profile?.tracking;
 return {notebook,section,tracking,subject:!!tracking?.subjects.includes(section?.key),event:!!tracking?.events.includes(section?.key)};
}
export function documentRecord(workspaceId,record,subject){
 if(!subject||subject.id===record.id)throw Error('Choose another saved record.');
 if(record.relations.some(l=>l.type==='Documents'&&l.target.workspaceId===workspaceId&&l.target.kind==='record'&&l.target.id===subject.id&&!l.target.revision))return false;
 record.relations.push({id:crypto.randomUUID(),type:'Documents',label:subject.title,target:{workspaceId,kind:'record',id:subject.id}});
 return true;
}
