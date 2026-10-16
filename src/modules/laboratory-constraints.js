import {withScratch} from '../scratch-work.js';
import {requireValue} from './validation.js';
export const laboratoryConstraintTypes=['lab-space','lab-entry'];
export async function validateLaboratorySource(source){
 await withScratch(async work=>{
  for await(const lab of source.all('lab-space'))for(const id of lab.data.scope.notebookIds)requireValue(await work.add(id),'A lab book can belong to only one lab space');
  for await(const {data:d} of source.all('lab-entry')){
   const lab=await source.get(d.labId);requireValue(lab?.type==='lab-space'&&lab.data.sections.some(s=>s.id===d.sectionId),'Lab record section');
  }
 });
}
