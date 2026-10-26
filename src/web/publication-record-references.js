import {proseReferences} from './prose-model.js';
import {attemptReferences} from './attempt-model.js';
import {researchReference} from './research-reference.js';
import {selectEditionRecord} from './publication-selection.js';

export function editionReferences(record){
 const values=[...record.relations.map(relation=>relation.target),...[record.body,...record.sections.map(section=>section.body)].flatMap(proseReferences),...attemptReferences(record.attempt).filter(target=>target.kind==='record')];
 return [...new Map(values.map(target=>[researchReference(target),target])).values()];
}
// Restore only optional details, never source consent or the other edition
// choices. This proves a stale reference was removed by the detail selection.
export function omittedEditionReferences(record,choice){
 if(choice?.details===undefined)return [];
 const selected=new Set(editionReferences(selectEditionRecord(record,choice)).map(researchReference));
 return editionReferences(selectEditionRecord(record,{...choice,details:undefined})).filter(target=>!selected.has(researchReference(target)));
}
