// Version 1 is a local, explicitly targeted exchange contract. Native formats
// are preserved as files; importing one never executes its contents.
import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
import {revisionText,revisionId} from '../web/revision-model.js';
import {researchId} from '../web/research-reference.js';
import {materialRef} from '../research-materials.js';
import {validAnalysisMethod} from '../web/analysis-model.js';
export const INTAKE_MANIFEST='intake.observanda.json';
export const INTAKE_LIMIT=4*1024*1024;
export const intakeHash=value=>digest(revisionText(value));
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const required=(v,n)=>text(v,n)&&v.trim().length>0;
export const intakePath=v=>required(v,512)&&!/[\\:\u0000-\u001f]/u.test(v)&&v.split('/').every(p=>p&&!['.','..'].includes(p)&&!/[ .]$/.test(p)&&!/[<>"|?*]/.test(p)&&! /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p));
const bad=()=>{throw new AppError('INTAKE_INVALID');};
export function validateIntake(value){
 if(!keys(value,['version','id','workspaceId','recordId','expectedRevision','purpose','title','files','analyses','record','source','verification'])||value.version!==1||!researchId(value.id)||!researchId(value.workspaceId)||!researchId(value.recordId)||!revisionId(value.expectedRevision)||!['preparation','evidence','analysis','amendment'].includes(value.purpose)||!required(value.title,300))bad();
 if(!Array.isArray(value.files)||value.files.length>1000||!Array.isArray(value.analyses)||value.analyses.length>32)bad();
 const names=new Set(),ids=new Set();let bytes=0;
 for(const f of value.files){
  if(!keys(f,['id','path','size','sha256','provenance'])||!researchId(f.id)||ids.has(f.id)||!intakePath(f.path)||f.path===INTAKE_MANIFEST||names.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||!revisionId(f.sha256)||!text(f.provenance,10000))bad();
  ids.add(f.id);names.add(f.path.toLowerCase());bytes+=f.size;if(!Number.isSafeInteger(bytes))bad();
 }
 const fileIds=new Set(ids),ref=r=>keys(r,['file'])&&fileIds.has(r.file)||materialRef(r);
 for(const a of value.analyses){
  if(!keys(a,['id','expectedRevision','title','tool','version','toolSha256','parameters','inputs','outputs','method'])||!researchId(a.id)||ids.has(a.id)||!(a.expectedRevision===null||revisionId(a.expectedRevision))||!required(a.title,300)||!required(a.tool,200)||!required(a.version,200)||!revisionId(a.toolSha256)||!text(a.parameters,20000)||!Array.isArray(a.inputs)||!a.inputs.length||a.inputs.length>64||!a.inputs.every(ref)||!Array.isArray(a.outputs)||a.outputs.length>64||!a.outputs.every(r=>ref(r)&&(r.file||r.kind==='artifact'))||a.method!==undefined&&!validAnalysisMethod(a.method))bad();
  ids.add(a.id);
 }
 if(value.record!==undefined&&(!keys(value.record,Object.keys(value.record??{}))||value.record.id!==value.recordId||value.record.share!==false))bad();
 if(!value.files.length&&!value.analyses.length&&!value.record)bad();
 if(!keys(value.source,['revision','sha256'])||!required(value.source.revision,500)||!revisionId(value.source.sha256))bad();
 if(!keys(value.verification,['tool','version','sha256','statement'])||!required(value.verification.tool,200)||!required(value.verification.version,200)||!revisionId(value.verification.sha256)||!required(value.verification.statement,2000))bad();
 if(Buffer.byteLength(JSON.stringify(value))>INTAKE_LIMIT)bad();return value;
}
export function intakePreview(manifest,pin){
 return {version:1,id:manifest.id,workspaceId:manifest.workspaceId,recordId:manifest.recordId,expectedRevision:manifest.expectedRevision,purpose:manifest.purpose,title:manifest.title,pin,
  files:manifest.files.map(({id,path,size,sha256})=>({id,path,size,sha256})),analyses:manifest.analyses.map(({id,title,expectedRevision,tool,version,toolSha256})=>({id,title,expectedRevision,tool,version,toolSha256})),changesRecord:!!manifest.record,source:manifest.source,verification:manifest.verification};
}
