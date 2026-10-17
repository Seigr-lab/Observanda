import {researchId} from './research-reference.js';
import {revisionId,revisionText} from './revision-model.js';

// Optional, record-owned evidence. A save appends facts; corrections identify
// their predecessor. No event advances progress or establishes an outcome.
export const EVENT_KINDS=['prepared','preparation-check','transported','installed','readback','executing','returned','acquired','reviewed','custom'];
export const EVENT_EXTENTS=['complete','partial','failed','cancelled','unknown'];
export const EVENT_CONTEXTS=['unspecified','host','physical'];
export const CONDITION_BASES=['stated','inherited','measured'];
export const ASSESSMENT_OUTCOMES=['met','not-met','unresolved','unavailable','not-assessed'];
export const INPUT_KINDS=['configuration','source','image','calibration','other'];
export const TIME_MEANINGS=['unknown','wall-clock','device-counter','elapsed','source-declared'];
export const emptyAttempt=()=>({version:1,preparations:[],events:[],assessments:[]});
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.slice().sort().join();
const text=(v,max=2000,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const unique=rows=>new Set(rows.map(r=>r?.id)).size===rows.length;
const facts=(rows,check)=>Array.isArray(rows)&&unique(rows)&&rows.every(check);
const list=(rows,max,check)=>Array.isArray(rows)&&rows.length<=max&&facts(rows,check);
export const attemptReference=ref=>keys(ref,['workspaceId','kind','id','revision','label'])&&researchId(ref.workspaceId)&&researchId(ref.id)&&revisionId(ref.revision)&&['record','artifact','dataset','analysis','collection'].includes(ref.kind)&&text(ref.label,300,true);
const optionalRef=ref=>ref===null||attemptReference(ref);
const refs=values=>Array.isArray(values)&&values.length<=20&&values.every(attemptReference)&&new Set(values.map(r=>revisionText(r))).size===values.length;
export const validAttemptTime=value=>keys(value,['meaning','value'])&&TIME_MEANINGS.includes(value.meaning)&&text(value.value,300)&&((value.meaning==='unknown')===!value.value.trim());
const base=(row,draft=false)=>researchId(row.id)&&(row.supersedes===null||researchId(row.supersedes))&&stamp(row.recordedAt)&&text(row.reason,2000,!draft&&!!row.supersedes);
export function validPreparation(p,{draft=false}={}){
 return keys(p,['id','supersedes','recordedAt','reason','applicability','basedOn','protocols','conditions','inputs','observations','criteria'])&&base(p,draft)&&text(p.applicability,2000,!draft)&&optionalRef(p.basedOn)&&refs(p.protocols)&&p.protocols.every(r=>r.kind==='record')&&
  list(p.conditions,64,c=>keys(c,['id','name','value','unit','basis','reference','reason'])&&researchId(c.id)&&text(c.name,160,!draft)&&text(c.value)&&text(c.unit,80)&&CONDITION_BASES.includes(c.basis)&&optionalRef(c.reference)&&text(c.reason)&&(draft||c.basis!=='inherited'||!!c.reference))&&
  list(p.inputs,64,i=>keys(i,['id','label','kind','algorithm','hash','reference'])&&researchId(i.id)&&text(i.label,160,!draft)&&INPUT_KINDS.includes(i.kind)&&['sha256','sha512'].includes(i.algorithm)&&(draft?text(i.hash,128):typeof i.hash==='string'&&new RegExp('^[a-f0-9]{'+(i.algorithm==='sha256'?64:128)+'}$','i').test(i.hash))&&optionalRef(i.reference))&&
  list(p.observations,64,o=>keys(o,['id','label'])&&researchId(o.id)&&text(o.label,2000,!draft))&&
  list(p.criteria,64,c=>keys(c,['id','label','expected','comparator','denominator','scope','reason'])&&researchId(c.id)&&text(c.label,160,!draft)&&text(c.expected)&&text(c.comparator,160,!draft)&&text(c.denominator,500)&&['prospective','exploratory'].includes(c.scope)&&text(c.reason,2000,!draft&&c.scope==='exploratory'));
}
export const attemptGroup=kind=>kind==='preparation'?'preparations':kind==='event'?'events':kind==='assessment'?'assessments':null;
// A checkpoint accepts unfinished form text but never arbitrary fields or
// unpinned references. A final save validates new facts against the admitted
// immutable history, or validates the complete history for a replacement.
export function validAttemptFact(kind,item,{draft=false,preparations=[],preparationById=null}={}){
 if(kind==='preparation')return validPreparation(item,{draft});
 const time=v=>draft?keys(v,['meaning','value'])&&TIME_MEANINGS.includes(v.meaning)&&text(v.value,300):validAttemptTime(v);
 const preparation=id=>preparationById?preparationById.get(id):preparations.find(p=>p.id===id);
 const p=item;
 if(kind==='event')return keys(p,['id','supersedes','recordedAt','reason','preparationId','kind','label','extent','context','circumstances','actor','source','time','references'])&&base(p,draft)&&(p.preparationId===null||(draft?researchId(p.preparationId):!!preparation(p.preparationId)))&&EVENT_KINDS.includes(p.kind)&&text(p.label,160,!draft&&p.kind==='custom')&&EVENT_EXTENTS.includes(p.extent)&&EVENT_CONTEXTS.includes(p.context)&&text(p.circumstances)&&text(p.actor,160)&&text(p.source,500)&&time(p.time)&&refs(p.references);
 if(kind==='assessment')return keys(p,['id','supersedes','recordedAt','reason','preparationId','criterionId','outcome','domainOutcome','observed','denominator','actor','source','time','references'])&&base(p,draft)&&(draft?(p.preparationId===null||p.preparationId===''||researchId(p.preparationId))&&(p.criterionId===''||researchId(p.criterionId)):preparation(p.preparationId)?.criteria.some(c=>c.id===p.criterionId))&&ASSESSMENT_OUTCOMES.includes(p.outcome)&&text(p.domainOutcome,500)&&text(p.observed)&&text(p.denominator,500)&&text(p.actor,160)&&text(p.source,500)&&time(p.time)&&text(p.reason,2000,!draft)&&refs(p.references);
 return false;
}
export function validAttempt(value,{draft=false}={}){
 if(!keys(value,['version','preparations','events','assessments'])||value.version!==1||!facts(value.preparations,p=>validPreparation(p,{draft})))return false;
 const preparationById=new Map(value.preparations.map(p=>[p.id,p]));
 if(!facts(value.events,e=>validAttemptFact('event',e,{draft,preparationById})))return false;
 if(!facts(value.assessments,a=>validAttemptFact('assessment',a,{draft,preparationById})))return false;
 const ids=[...value.preparations,...value.events,...value.assessments].map(r=>r.id);if(new Set(ids).size!==ids.length)return false;
 if(draft)return true;
 for(const group of ['preparations','events','assessments']){
  const seen=new Map(),replaced=new Set();
  for(const item of value[group]){
   if(item.supersedes){const prior=seen.get(item.supersedes);if(!prior||replaced.has(prior.id))return false;
    if(group==='assessments'&&(prior.preparationId!==item.preparationId||prior.criterionId!==item.criterionId))return false;
    replaced.add(prior.id);
   }else if(group==='preparations'&&seen.size)return false;
   seen.set(item.id,item);
  }
 }
 return true;
}
export function attemptReferences(value){
 if(!value)return [];
 return value.preparations.flatMap(p=>[p.basedOn,...p.protocols,...p.conditions.map(c=>c.reference),...p.inputs.map(i=>i.reference)]).concat(value.events.flatMap(e=>e.references),value.assessments.flatMap(a=>a.references)).filter(Boolean);
}
export function appendOnlyAttempt(previous,next){
 if(next!==undefined&&!validAttempt(next))return false;
 if(!previous)return true;if(!next)return false;
 return ['preparations','events','assessments'].every(group=>previous[group].every((item,i)=>revisionText(item)===revisionText(next[group][i])));
}
export function currentAttemptItems(rows){const superseded=new Set(rows.map(row=>row.supersedes));return rows.filter(row=>!superseded.has(row.id));}
export function mergeAttemptAdditions(base,mine,stored){
 if(!mine||!stored||!appendOnlyAttempt(base,mine)||!appendOnlyAttempt(base,stored))return null;
 const merged=structuredClone(stored);
 for(const group of ['preparations','events','assessments']){
  const identities=new Map(merged[group].map(row=>[row.id,row]));
  for(const row of mine[group]){
   const existing=identities.get(row.id);
   if(existing){if(revisionText(existing)!==revisionText(row))return null;}
   else{const copy=structuredClone(row);merged[group].push(copy);identities.set(row.id,copy);}
  }
 }
 return validAttempt(merged)?merged:null;
}
export function repeatPreparation(record,reference,{uuid=()=>crypto.randomUUID(),now=new Date(),reason=''}={}){
 const prior=record.attempt?.preparations.at(-1);if(!prior)return undefined;
 const preparation=structuredClone(prior);
 preparation.id=uuid();preparation.supersedes=null;preparation.recordedAt=now.toISOString();preparation.basedOn=reference;preparation.reason=reason;
 // Repeating a measured value is inheritance, never another measurement.
 preparation.conditions=preparation.conditions.map(c=>({...c,basis:'inherited',reference}));
 return {...emptyAttempt(),preparations:[preparation]};
}
export function attemptComparison(value){
 if(!value)return null;
 const preparation=value.preparations.at(-1),preparations=new Map(value.preparations.map((item,position)=>[item.id,{item,number:position+1}]));
 return {preparationId:preparation?.id??null,preparationNumber:value.preparations.length,applicability:preparation?.applicability??'',conditions:preparation?.conditions.map(({id,name,value,unit,basis})=>({id,name,value,unit,basis}))??[],
  assessments:currentAttemptItems(value.assessments).map(a=>{
   const {item:p,number}=preparations.get(a.preparationId),c=p.criteria.find(c=>c.id===a.criterionId);
   return {criterion:c.label,preparationId:a.preparationId,preparationNumber:number,expected:c.expected,comparator:c.comparator,scope:c.scope,outcome:a.outcome,domainOutcome:a.domainOutcome,observed:a.observed,denominator:a.denominator};
  }),
  events:currentAttemptItems(value.events).map(({kind,label,extent,context})=>({kind,label,extent,context}))};
}

// Search authored facts, including superseded observations, without indexing
// opaque identities or treating an interface translation as research content.
export function attemptSearchText(value){
 if(!value)return '';
 return [...value.preparations.flatMap(p=>attemptFactSearchParts('preparation',p)),...value.events.flatMap(e=>attemptFactSearchParts('event',e)),...value.assessments.flatMap(a=>attemptFactSearchParts('assessment',a)),...attemptReferences(value).map(r=>r.label)].join(' ');
}
export function attemptFactSearchParts(kind,value){
 if(kind==='preparation'){const p=value;return [p.applicability,p.reason,...p.conditions.flatMap(c=>[c.name,c.value,c.unit,c.reason]),...p.inputs.map(i=>i.label),...p.observations.map(o=>o.label),...p.criteria.flatMap(c=>[c.label,c.expected,c.comparator,c.denominator,c.reason])];}
 if(kind==='event'){const e=value;return [e.kind,e.label,e.extent,e.context,e.circumstances,e.actor,e.source,e.time.value,e.reason];}
 const a=value;return [a.outcome,a.domainOutcome,a.observed,a.denominator,a.actor,a.source,a.time.value,a.reason];
}
