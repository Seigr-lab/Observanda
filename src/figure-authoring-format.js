import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
// Draft-only figure data and independently authored saved figures require the
// same admission boundary across records, checkpoints and portable copies.
export const hasAuthoredFigure=figure=>figure?.kind==='retained'&&(!figure.source||figure.document?.format==='figure-authoring')||figure?.kind==='panels'&&figure.panels?.some(panel=>hasAuthoredFigure(panel.figure))===true;
export const hasAuthoredFigures=record=>record?.figures?.some(hasAuthoredFigure)===true;
export async function authoredFigureDocument(document,{signal}={}){
 if(!await document.tree.select(document.root,['figures']))return false;
 const authored=async root=>(await document.tree.selected(root,['kind'])).value==='retained'&&(!(await document.tree.selected(root,['source'])).found||(await document.tree.selected(root,['document','format'])).value==='figure-authoring');
 for await(const figure of document.items(['figures'],{signal})){
  signal?.throwIfAborted();if(await authored(figure.value))return true;
  if((await document.tree.selected(figure.value,['kind'])).value==='panels')for await(const panel of document.items(['figures',String(figure.index),'panels'],{signal})){
   const selected=await document.tree.select(panel.value,['figure']);if(selected&&(selected.inline?hasAuthoredFigure(selected.value):await authored(selected.revision)))return true;
  }
 }
 return false;
}

export const validFigureEdit=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='operationId,request'&&researchId(value.operationId)&&revisionId(value.request);
