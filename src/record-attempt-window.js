import {preparationProjection,preparationRowById} from './record-preparation-document.js';
// Reading windows contain visible facts and only the preparation context those
// facts require. Correction state is resolved against the entire pinned history.
import {emptyAttempt} from './web/attempt-model.js';
import {attemptGroups} from './record-attempt-document.js';
import {AppError} from './errors.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
export async function recordAttemptWindow(document,{windows={},signal}={}){
 if(!await document.reference(['attempt'],{signal}))return {attempt:undefined,pages:{},window:null};
 const attempt=emptyAttempt(),pages={},window={preparationPositions:{},visiblePreparations:[],superseded:[],hasCriteria:false,preparationCollections:{},criterionValues:{}},needed=new Set(),visible=new Set();
 for(const group of attemptGroups){
  const path=['attempt',group],total=await document.tree.arrayLength(document.root,path),offset=Math.min(windows[group]??0,Math.max(0,total-1));
  const page={values:[]};for await(const row of document.items(path,{offset,limit:4,signal})){if(group==='preparations'){const selected=await preparationProjection(document,row.value,{windows,signal});page.values.push(selected.value);Object.assign(pages,selected.pages);window.preparationCollections[selected.value.id]=selected.pages;}else page.values.push(await document.tree.read(row.value));}attempt[group]=page.values;pages[group]={offset,total,count:page.values.length};
  for(const item of page.values){visible.add(item.id);if(item.preparationId)needed.add(item.preparationId);}
  if(group==='preparations')for(const [index,item] of page.values.entries()){window.visiblePreparations.push(item.id);window.preparationPositions[item.id]=offset+index;}
 }
 for(const item of attempt.preparations)needed.delete(item.id);
 const index=await RecordAttemptIndex.open(document,{signal});
 if(index){
  window.hasCriteria=!!await index.latestCriteria();
  for(const id of needed){const found=await index.fact(id,'preparations');if(!found)throw new AppError('CATALOGUE_DAMAGED');const selected=await preparationProjection(document,await document.reference(['attempt','preparations',String(found.position)],{signal}),{windows,signal});attempt.preparations.push(selected.value);window.preparationPositions[id]=found.position;}needed.clear();
 }else for await(const item of document.items(['attempt','preparations'],{signal})){
  const id=(await document.tree.selected(item.value,['id'])).value;
  if(!window.hasCriteria)window.hasCriteria=await document.tree.arrayLength(item.value,['criteria'])>0;
  if(needed.has(id)){attempt.preparations.push((await preparationProjection(document,item.value,{windows,signal})).value);window.preparationPositions[id]=item.index;needed.delete(id);}
 }
 if(needed.size)throw new AppError('CATALOGUE_DAMAGED');
 for(const assessment of attempt.assessments){const preparation=attempt.preparations.find(p=>p.id===assessment.preparationId);let criterion=preparation?.criteria.find(c=>c.id===assessment.criterionId);
  if(!criterion){const selected=await index?.nested(assessment.preparationId,'criteria',assessment.criterionId);if(selected)criterion=await document.tree.read(selected.reference);else{const ref=await document.reference(['attempt','preparations',String(window.preparationPositions[assessment.preparationId])]);criterion=(await preparationRowById(document,ref,'criteria',assessment.criterionId,{signal}))?.value;}}
  if(!criterion)throw new AppError('CATALOGUE_DAMAGED');window.criterionValues[assessment.preparationId+':'+assessment.criterionId]=criterion;
 }

 attempt.preparations.sort((a,b)=>window.preparationPositions[a.id]-window.preparationPositions[b.id]);
 if(index){for(const id of visible){signal?.throwIfAborted();if(await index.correction(id))window.superseded.push(id);}}
 else for(const group of attemptGroups)for await(const item of document.items(['attempt',group],{signal})){
  const prior=(await document.tree.selected(item.value,['supersedes'])).value;if(prior&&visible.has(prior))window.superseded.push(prior);
 }
 return {attempt,pages,window};
}
