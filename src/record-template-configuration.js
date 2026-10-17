// A first save proves the embedded schema still belongs to the selected book.
// Compare immutable field streams without hydrating the growing field list.
import {createHash} from 'node:crypto';
import {recordContentRevision} from './record-encoding.js';
import {ConfigurationDocuments} from './configuration-documents.js';
import {emptyConfiguration} from './web/notebook-schema.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
async function content(tree,root,{signal}={}){const hash=createHash('sha256');for await(const text of tree.json(root,{canonical:true,signal})){signal?.throwIfAborted();hash.update(text);}return hash.digest('hex');}
async function currentSection(store,metadata,header,{signal}={}){
 const book=metadata.notebooks.find(value=>value.id===header.notebookId);if(!book)throw new AppError('RECORD_CHANGED');
 const owner={workspaceId:metadata.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'},reader=await new ConfigurationDocuments(store).open(owner,book.configuration??emptyConfiguration(),{signal});
 const section=await reader.sectionReference({id:header.template.id},{signal});if(!section?.value.enabled)throw new AppError('RECORD_CHANGED');
 if(section.value.profileId!==null&&!(await reader.item({collection:'profiles',key:section.value.profileId},{signal}))?.value.enabled)throw new AppError('RECORD_CHANGED');
 const expected=Object.fromEntries(['id','profileId','label','description'].map(key=>[key,section.value[key]])),actual=Object.fromEntries(Object.keys(expected).map(key=>[key,header.template[key]]));
 if(serialize(actual)!==serialize(expected))throw new AppError('RECORD_CHANGED');return {reader,section};
}
export async function validateCurrentRecordTemplate(store,snapshot,document,header,{signal}={}){
 if(!header.template)return;
 const {reader,section}=await currentSection(store,snapshot.metadata,header,{signal}),fields=await document.reference(['template','fields'],{signal});
 if(!fields||await content(document.tree,fields,{signal})!==await content(reader.document.tree,section.fields,{signal}))throw new AppError('RECORD_CHANGED');
}
// Older bounded whole-record commands still prove their supplied schema
// against the same selected owner; the saved configuration remains referenced.
export async function validateCurrentInlineRecordTemplate(store,metadata,record,{signal}={}){
 const {reader,section}=await currentSection(store,metadata,record,{signal});
 if(recordContentRevision(record.template.fields,{signal})!==await content(reader.document.tree,section.fields,{signal}))throw new AppError('RECORD_CHANGED');
}
