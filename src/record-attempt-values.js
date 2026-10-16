import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {emptyAttempt,validAttemptFact,attemptReferences} from './web/attempt-model.js';
import {preparationMethodLinks} from './web/attempt-workflow.js';
import {ResearchMaterials} from './research-materials.js';
import {attemptFactPosition,attemptSuccessor,attemptValueContext} from './record-attempt-context.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {SnapshotIndex} from './snapshot-index.js';

export async function selectedAttemptValue(document,field,{signal}={}){
 const fact=attemptValueField(field),position=await attemptFactPosition(document,fact.group,fact.id,{signal}),path=position<0?null:['attempt',fact.group,String(position)],value={value:path?(await document.field(path,{signal})).value:null};
 return {fact,position,path,value,revision:digest(serialize(value)),definition:await attemptValueContext(document,field,{signal,selected:value.value})};
}
export async function replaceAttemptValue(document,value,selected){
 if(!(await document.tree.select(document.root,['attempt'])))document=await document.property([],'attempt',emptyAttempt());
 return selected.position<0?document.splice(['attempt',selected.fact.group],await document.tree.arrayLength(document.root,['attempt',selected.fact.group]),0,[value.value]):document.replace(selected.path,value.value);
}
// Only append a fact to the current history. Independently saved prose, figures
// and relationships stay as references; preparation methods are linked atomically.
export async function prepareAttemptValue(workspace,store,{command,selected,original,row,snapshot}){
 if(selected.value.value!==null)throw new AppError('ATTEMPT_IMMUTABLE');
 const item=command.value.value,group=selected.fact.group,context=await attemptValueContext(original,command.field,{prior:item.supersedes,preparationId:item.preparationId??null});
 if(group==='preparations'&&context.latestPreparationId!==item.supersedes||item.supersedes&&context.correctionId!==item.supersedes)throw new AppError('ATTEMPT_CONFLICT');
 if(!validAttemptFact(selected.fact.kind,item,{preparations:context.attempt.preparations}))throw new AppError('INVALID');
 const materials=new ResearchMaterials(workspace);
 for(const ref of attemptReferences({...emptyAttempt(),[group]:[item]})){
  if(!ref.workspaceId||!await referenceNamespaceMatches(store,ref)||ref.kind==='record'&&ref.id===row.id)throw new AppError('ATTEMPT_REFERENCE');
  await materials.checkReference(ref);
 }
 let document=await replaceAttemptValue(original,command.value,selected),member={...row,hasAttempt:true},summaries=[];
 if(group==='preparations'){
  const links=preparationMethodLinks([],{preparations:[item]});
  for await(const relation of original.items(['relations'])){
   if(!links.length)break;
   if((await original.tree.selected(relation.value,['role'])).value!=='uses-method')continue;
   const target=(await original.tree.selected(relation.value,['target'])).value,index=links.findIndex(l=>l.target.workspaceId===target.workspaceId&&l.target.id===target.id&&l.target.revision===target.revision);
   if(index>=0)links.splice(index,1);
  }
  if(links.length){
   document=await document.splice(['relations'],await document.tree.arrayLength(document.root,['relations']),0,links);
   member=await new RecordMemberCollections(store).changed(member,'relations',document);
   summaries=await new SnapshotIndex(store).validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:[],relations:links}]);
  }
 }
 return {document,member,summaries};
}
