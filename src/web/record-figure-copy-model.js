import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {figurePlots} from './figure-composition.js';
const keys=(value,names)=>value&&Object.keys(value).sort().join()===names;
export const validFigureCopySource=source=>keys(source,'id,kind,revision,workspaceId')&&source.kind==='record'&&researchId(source.id)&&researchId(source.workspaceId)&&revisionId(source.revision);
export function validFigureCopies(copies,figure){
 if(!Array.isArray(copies)||!copies.length)return false;
 const targets=new Set(figure?figurePlots(figure).map(plot=>plot.id):[]),seen=new Set();
 return copies.every(copy=>{
  if(!keys(copy,'figureId,plotId,source,targetId')||!validFigureCopySource(copy.source)||![copy.figureId,copy.plotId,copy.targetId].every(researchId)||seen.has(copy.targetId)||figure&&!targets.has(copy.targetId))return false;
  seen.add(copy.targetId);return true;
 });
}
