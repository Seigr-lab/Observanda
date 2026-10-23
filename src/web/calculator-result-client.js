import {researchId} from './research-reference.js';
import {validMaterialReference} from './material-reference.js';
import {validReferenceOwner} from './modules/reference-client.js';
import {projectApiRoute,researchOwner} from './project-context.js';
const aborted=()=>new DOMException('Calculator result selection changed','AbortError');
const invalid=()=>{throw Error('CALCULATOR_RESULT_RESPONSE');};
const ownerRoute=owner=>owner.projectId?{projectId:owner.projectId,...(owner.labBookId?{labBookId:owner.labBookId}:{})}:null;
export const savedCalculator=draft=>draft?.type==='calculation'&&Number.isSafeInteger(draft.expectedRevision)&&draft.expectedRevision>0&&JSON.stringify(draft.base)===JSON.stringify(draft.data);
// Both ends are captured explicitly. Neither successful reads nor destination
// writes adopt another owner into the source editor.
export function calculatorResultClient({state,researchApi,current,access=run=>run(),active=()=>state.page==='module'&&state.moduleId==='scientific-calculator'}){
 let generation=0;const requests=new Set();
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,researchOwner(state),state.page,state.moduleId,state.modulePath,current()?.id,current()?.expectedRevision,current()?.data]);
 const available=()=>active()&&!state.access?.locked&&!state.storageUnavailable;
 function cancel(){generation++;for(const request of requests)request.abort();requests.clear();}
 function capture(expressionIndex){
  const draft=current();if(!available()||!savedCalculator(draft)||![2,3].includes(draft.data.engine)||draft.data.mode!=='expression'||!Number.isSafeInteger(expressionIndex)||expressionIndex<0||expressionIndex>=draft.data.expression.split(/\r?\n/).length)throw Error('CALCULATOR_RESULT_SAVED');
  const stamp=identity(),epoch=generation,source={workspaceId:state.book.id,type:'calculation',id:draft.id,revision:draft.expectedRevision};
  return {source,expressionIndex,current:()=>epoch===generation&&stamp===identity()&&available()};
 }
 function destination(target){
  if(!validReferenceOwner(target?.owner)||target?.reference?.type!=='record'||!researchId(target.reference.id)||!researchId(target.reference.workspaceId)||target.openType!=='record'||!researchId(target.openId))invalid();
  return Object.freeze({workspaceId:target.owner.workspaceId,recordId:target.openId,owner:structuredClone(ownerRoute(target.owner)),title:target.title});
 }
 async function request(captured,dest,operation,body,{signal,unlock=false}={}){
  if(!captured?.current()||!dest||!researchId(dest.workspaceId)||!researchId(dest.recordId)||typeof researchApi!=='function')throw aborted();
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;requests.add(controller);
  const current=()=>!combined.aborted&&captured.current();
  const run=async()=>{if(!current())throw aborted();try{const result=await researchApi(projectApiRoute('/api/research/materials/'+operation,dest.owner),{...body,workspaceId:dest.workspaceId},{owner:dest.owner,adopt:false,signal:combined});if(!current())throw aborted();return result;}catch(error){if(!current())throw aborted();throw error;}};
  try{const result=await(unlock?access(run):run());if(!current())throw aborted();if(operation==='calculator-retain'?result?.workspaceId!==dest.workspaceId:result?.workspaceId!==undefined&&result.workspaceId!==dest.workspaceId)invalid();return result;}finally{requests.delete(controller);}
 }
 function job(result,id){if(result?.job?.id!==id||result.job.type!=='dataset.prepare'||!['queued','running','completed','failed','cancelled'].includes(result.job.state)||result.job.state==='completed'&&(!validMaterialReference(result.job.result)||result.job.result.kind!=='dataset'))invalid();return result;}
 return {capture,destination,cancel,
  async retain(captured,dest,{title,recipeId,jobId},options={}){if(!researchId(recipeId)||!researchId(jobId)||recipeId===jobId||typeof title!=='string'||!title.trim()||title.length>300)invalid();const result=await request(captured,dest,'calculator-retain',{recordId:dest.recordId,title,source:captured.source,expressionIndex:captured.expressionIndex,recipeId,jobId},{...options,unlock:true});if(!validMaterialReference(result.recipe)||result.recipe.kind!=='analysis')invalid();return job(result,jobId);},
  async status(captured,dest,id,options={}){return job(await request(captured,dest,'job',{id},options),id);},
  async control(captured,dest,id,action,options={}){if(!['retry-job','cancel-job'].includes(action))invalid();return job(await request(captured,dest,action,{id},{...options,unlock:action==='retry-job'}),id);}
 };
}
