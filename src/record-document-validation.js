// Validate a retained record one domain value at a time. The synchronous model
// remains the source of field rules; collection-wide identities live in bounded
// encrypted scratch storage rather than sets proportional to record length.
import {validateDetachedRecords,validateRecordChanges} from './model.js';
import {bookSelectors} from './web/book-selectors.js';
import {figureTargets} from './web/figure-composition.js';
import {workflowIssues} from './web/record-workflow.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
import {recordTemplateHeader,validateRecordTemplate} from './record-template-document.js';
import {attemptDocumentHeader,validateAttemptDocument} from './record-attempt-document.js';
import {resultDocumentHeader,validateResultDocument} from './record-result-document.js';

const collections=['sections','contributors','relations','figures','attachments','tags'];
const ordinaryDetails=new Set(['title','status','outcome','occurredOn','share','updatedAt']);
const invalid=(field,recordId)=>{throw new AppError('INVALID',[{field,recordId}]);};
// Only the admitted current original can prove unchanged owners. Detail and
// result edits preserve other collections; changed results receive independent
// admission against their source-pinned identity index.
async function reusableOwners(document,admitted,names,{signal}={}){
 if(!admitted)return null;
 const before=await admitted.tree.propertyNames(admitted.root),owners=new Set([...names,...before]);let resultsChanged=false;
 for(const name of owners){
  signal?.throwIfAborted();if(ordinaryDetails.has(name))continue;
  if(await document.reference([name],{signal})===await admitted.reference([name],{signal}))continue;
  if(name==='results')resultsChanged=true;else return null;
 }
 return {resultsChanged};
}
export async function validateRecordDocument(document,metadata,{signal,summaries=[],admitted=null}={}){
 if(metadata.formatVersion!==21)throw new AppError('FORMAT');
 const header={},names=await document.tree.propertyNames(document.root);
 const reuse=await reusableOwners(document,admitted,names,{signal});
 for(const name of names){
  signal?.throwIfAborted();
  Object.defineProperty(header,name,{value:collections.includes(name)?[]:name==='attempt'?await (reuse?attemptDocumentHeader:validateAttemptDocument)(document,{signal}):name==='results'?await (reuse&&!reuse.resultsChanged?resultDocumentHeader:validateResultDocument)(document,{signal,admitted:reuse?admitted:null}):name==='template'?await recordTemplateHeader(document,{signal}):(await document.field([name],{signal})).value,enumerable:true,writable:true});
 }
 if(!reuse)await validateRecordTemplate(document,header.template,{signal});
 validateRecordChanges(metadata,[header],summaries,{capacity:false});
 if(reuse){signal?.throwIfAborted();return header;}
 const blank={...header,body:''};let parents=0;
 return withScratch(async identities=>{
  const unique=async(kind,id,field)=>{if(!await identities.add(kind+':'+id))invalid(field,header.id);};
  for(const id of [metadata.id,...metadata.projects.map(v=>v.id),...metadata.notebooks.map(v=>v.id),...(metadata.pages??[]).map(v=>v.id),...(metadata.themes??[]).map(v=>v.id),header.id])await unique('identity',id,'notebook');
  for(const selector of bookSelectors(header))await unique('selector:'+selector.kind,selector.id,'duplicate book content identity');
  for(const name of collections){
   for await(const ref of document.items([name],{signal})){
    signal?.throwIfAborted();const item=await document.tree.read(ref.value),part={...blank,[name]:[item]};
    validateDetachedRecords([part]);
    if(name==='sections')await unique('identity',item.id,'sections');
    if(['contributors','relations','attachments'].includes(name))await unique(name,item.id,name);
    if(name==='figures')for(const figure of figureTargets([item]))await unique('figures',figure.id,'figures');
    for(const selector of bookSelectors(part))await unique('selector:'+selector.kind,selector.id,'duplicate book content identity');
    if(name==='relations'){
     validateRecordChanges(metadata,[part],summaries,{capacity:false});
     const issues=workflowIssues({...metadata,entries:[part]});if(issues.length)throw new AppError('INVALID',issues);
     if(item.role==='run-of'&&++parents>1)invalid('Choose one investigation or creative series for this run.',header.id);
    }
   }
  }
  signal?.throwIfAborted();return header;
 },{signal});
}
