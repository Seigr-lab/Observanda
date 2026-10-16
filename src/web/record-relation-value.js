import {parseResearchReference,researchReference} from './research-reference.js';
import {workflowRole} from './record-workflow.js';
const text=value=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
// Checkpoints can retain an incomplete reference. Only a canonical, parsed
// target can become a saved research link through the record validator.
export function validRelationValue(value){
 return value&&Object.keys(value).sort().join()===(Object.hasOwn(value,'role')?'label,reference,role,type':'label,reference,type')&&['type','label','reference'].every(key=>text(value[key]))&&(!Object.hasOwn(value,'role')||!!workflowRole(value.role));
}
export function canonicalRelationValue(value){return {type:value.type,label:value.label,reference:value.reference,...(Object.hasOwn(value,'role')?{role:value.role}:{})};}
export function relationValue(relation){
 return {type:relation.type,label:relation.label,reference:typeof relation.target==='string'?relation.target:researchReference(relation.target),...(relation.role?{role:relation.role}:{})};
}
export function relationFromValue(id,value){
 const parsed=parseResearchReference(value.reference),target=parsed&&researchReference(parsed)===value.reference?parsed:value.reference;
 return {id,type:value.type,label:value.label,target,...(value.role?{role:value.role}:{})};
}
