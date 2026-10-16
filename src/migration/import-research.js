import {AppError} from '../errors.js';
import {selectedJSON} from '../structured-selection.js';
import {mappedId} from './import-model.js';
import {validAttempt,attemptReferences} from '../web/attempt-model.js';
import {validTemplate} from '../web/notebook-schema.js';
import {validResults} from '../web/result-statements.js';
import {ResearchMaterials} from '../research-materials.js';
import {validateResultSources} from '../result-statements.js';

const fail=()=>{throw new AppError('IMPORT_RESEARCH');};
// Optional, explicitly selected portable record facts. Source-specific adapters
// provide this declaration; the importer never guesses semantics from prose.
export async function importResearch(attributesText,mapping,record,{signal}={}){
 if(!mapping)return record;
 if(typeof attributesText!=='string')fail();
 const selected=await selectedJSON([Buffer.from(attributesText)],mapping.path,{signal});let source;
 try{source=JSON.parse(selected,(_key,value,context)=>{if(typeof value==='number'&&(!Number.isSafeInteger(value)||!/^[-]?(?:0|[1-9]\d*)$/.test(context.source)))fail();return value;});}catch(error){if(error instanceof AppError)throw error;fail();}
 if(!source||source.format!=='observanda-record-facts'||source.version!==1||Object.keys(source).some(k=>!['format','version','status','outcome','template','attempt','results'].includes(k)))fail();
 const next=structuredClone(record),identity=value=>{
  if(typeof value!=='string'||!value.trim()||value.length>200)fail();return mappedId(record.id,'research-fact',value);
 };
 const reference=value=>{
  if(value===null)return null;
  if(value&&Object.keys(value).join()==='link'&&Number.isInteger(value.link)&&value.link>=0){
   const relation=record.relations.find(r=>r.id===mappedId(record.id,'link',value.link));
   if(!relation?.target.revision)fail();return {...relation.target,label:relation.label};
  }
  // Existing native references are verified by the ordinary research services.
  return structuredClone(value);
 };
 try{
  if(Object.hasOwn(source,'status'))next.status=source.status;
  if(Object.hasOwn(source,'outcome'))next.outcome=source.outcome;
  if(Object.hasOwn(source,'template')){
   next.template=structuredClone(source.template);
   if(next.template)next.template.id=identity(next.template.id);
   if(!validTemplate(next.template))fail();
  }
  if(Object.hasOwn(source,'attempt')){
   const a=structuredClone(source.attempt);
   for(const p of a.preparations){
    p.id=identity(p.id);p.supersedes=p.supersedes===null?null:identity(p.supersedes);p.basedOn=reference(p.basedOn);p.protocols=p.protocols.map(reference);
    // Every method used is visible both in the preparation and in research
    // relationships. Require the reviewed exact uses-method relationship.
    for(const protocol of p.protocols)if(!record.relations.some(r=>r.role==='uses-method'&&r.target.id===protocol.id&&r.target.revision===protocol.revision&&r.target.workspaceId===protocol.workspaceId))fail();
    for(const c of p.conditions){c.id=identity(c.id);c.reference=reference(c.reference);}
    for(const input of p.inputs){input.id=identity(input.id);input.reference=reference(input.reference);}
    for(const item of [...p.observations,...p.criteria])item.id=identity(item.id);
   }
   for(const item of [...a.events,...a.assessments]){
    item.id=identity(item.id);item.supersedes=item.supersedes===null?null:identity(item.supersedes);
    if(item.preparationId!==null)item.preparationId=identity(item.preparationId);
    if(Object.hasOwn(item,'criterionId'))item.criterionId=identity(item.criterionId);
    item.references=item.references.map(reference);
   }
   if(!validAttempt(a))fail();next.attempt=a;
  }
  if(Object.hasOwn(source,'results')){
   const results=structuredClone(source.results);
   for(const statement of results.statements){
    statement.id=identity(statement.id);
    if(statement.kind==='figure'){
     const selection=statement.figureId;
     if(selection&&typeof selection==='object'&&Object.keys(selection).every(k=>['figure','panel'].includes(k))&&Number.isInteger(selection.figure)&&selection.figure>=0){
      const f=record.figures[selection.figure];statement.figureId=selection.panel===undefined?f?.id:Number.isInteger(selection.panel)&&selection.panel>=0?f?.panels?.[selection.panel]?.figure.id:null;
     }else fail();
    }
   }
   if(!validResults(results))fail();next.results=results;
  }
 }catch(error){if(error instanceof AppError)throw error;fail();}
 return next;
}

// Exact source links refer to earlier reviewed declarations in this batch.
// Other references must already exist; a missing reference is a review problem,
// not something users should discover after confirming the import.
export async function verifyImportedResearch(workspace,workspaceId,record){
 const materials=new ResearchMaterials(workspace);
 for(const ref of attemptReferences(record.attempt)){
  if(ref.workspaceId!==workspaceId||ref.kind==='record'&&ref.id===record.id)throw new AppError('ATTEMPT_REFERENCE');
  if(ref.kind==='record'&&record.relations.some(r=>r.target.id===ref.id&&r.target.revision===ref.revision&&r.target.workspaceId===ref.workspaceId))continue;
  await materials.read(ref);
 }
 await validateResultSources(workspace,record);
}
