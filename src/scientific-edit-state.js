import {exact,object} from './modules/validation.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {materialKinds,materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {evidencePurposes} from './web/evidence-files.js';
import {validGraphAddress} from './web/dataset-calculation-graph-model.js';
import {statisticalUncertaintyCell} from './web/measurement-statistical-uncertainty-model.js';

// Pending edits may contain partial numerals, absent units or an incomplete
// operand. Only an explicit scientific save applies the domain's final rules.
const index=value=>Number.isSafeInteger(value)&&value>=0;
const string=value=>typeof value==='string';
const nullableRef=value=>value===null||validMaterialReference(value);
function validBuilder(value){
 const setting=item=>item===null||exact(item,['title','ref'])&&string(item.title)&&validMaterialReference(item.ref)&&item.ref.kind==='analysis';
 return exact(value,['id','target','relative','paths','adapter','profile','extensions','fields',...(value&&Object.hasOwn(value,'amends')?['amends']:[])])&&researchId(value.id)&&
  (value.amends==null||exact(value.amends,['id','pin','title','date'])&&researchId(value.amends.id)&&revisionId(value.amends.pin)&&string(value.amends.title)&&string(value.amends.date))&&
  exact(value.target,['id','revision'])&&researchId(value.target.id)&&revisionId(value.target.revision)&&string(value.relative)&&
  Array.isArray(value.paths)&&value.paths.length<=1000&&value.paths.every(string)&&setting(value.adapter)&&setting(value.profile)&&
  Array.isArray(value.extensions)&&value.extensions.every(string)&&exact(value.fields,['packageTitle','purpose','sourceRevision','method','toolName','toolVersion','adapterName'])&&
  Object.values(value.fields).every(string);
}
const pair=value=>Array.isArray(value)&&value.length===2&&index(value[0])&&object(value[1])&&string(value[1].name)&&string(value[1].representation)&&Array.isArray(value[1].missing)&&value[1].missing.every(item=>object(item)&&string(item.value)&&string(item.meaning));
const intent=value=>{
 if(value===null)return true;
 return exact(value,['key','id'])&&revisionId(value.key)&&researchId(value.id);
};
const identity=value=>object(value)&&exact(value,['id','expectedRevision','jobId',...(Object.hasOwn(value,'key')?['key']:[])])&&researchId(value.id)&&researchId(value.jobId)&&(value.key===undefined||revisionId(value.key))&&(value.expectedRevision===null||revisionId(value.expectedRevision));
const scalar=value=>object(value)&&typeof value.representation==='string'&&(string(value.spelling)||object(value.spelling));
const recipe=value=>object(value)&&nullableRef(value.source)&&object(value.range)&&object(value.resourcePolicy);
function plotMapping(value){
 if(!object(value)||!index(value.x)||value.group!==null&&!index(value.group)||!Array.isArray(value.values)||!object(value.resourcePolicy))return false;
 return value.values.every(series=>object(series)&&index(series.column)&&['error','xLower','xUpper','yLower','yUpper','count'].every(key=>series[key]==null||index(series[key])));
}
const frequencyGrid=value=>object(value)&&scalar(value.start)&&scalar(value.step);
const operand=value=>value?.kind==='cell'?value.source===null||statisticalUncertaintyCell(value.source):value?.kind==='declared'&&scalar(value.scalar)&&(value.unitDefinition===undefined||object(value.unitDefinition))&&string(value.rationale);
function evidenceIntent(value){
 const entry=value.intent;
 return entry===null||exact(entry,['id','recordId','title','provenance','purpose','sourceMode','count','bytes'])&&researchId(entry.id)&&researchId(entry.recordId)&&entry.title===value.title.trim()&&entry.provenance===value.provenance&&entry.purpose===value.purpose&&entry.sourceMode===value.mode&&entry.count===value.selection?.count&&index(entry.bytes);
}
const opaqueField=/(?:^__proto__$|^constructor$|^prototype$)/;
const referenceKinds=new Set(['record',...materialKinds]);
const graphKinds=new Set(['column','window','constant','scalar','comparison','boolean','domain','clock','interval','domain-arithmetic','clock-synchronize','domain-reshape','domain-permute','coordinate-transform','domain-sequence','domain-topology']);
function graphItem(item){
 if(!object(item)||!researchId(item.id)||!graphKinds.has(item.kind))return false;
 if(item.kind==='constant')return object(item.value)&&string(item.value.constant);
 if(item.kind==='domain-permute')return Array.isArray(item.axes);
 if(item.kind==='domain-reshape')return Array.isArray(item.shape);
 if(item.kind==='domain')return item.component==null||Array.isArray(item.component);
 if(['domain-sequence','domain-topology'].includes(item.kind))return object(item.operation)&&string(item.operation.kind);
 return true;
}
function graphFields(fields){
 if(!object(fields))return false;
 return Object.entries(fields).every(([key,value])=>{
  if(!/^[a-z][a-zA-Z0-9-]*$/.test(key)||!string(value))return false;
  if(!value||!['left','right','condition','binding','node'].includes(key))return true;
  try{return validGraphAddress(JSON.parse(value));}catch{return false;}
 });
}
const kinds={
 'schema':value=>exact(value,['offset','rowPage','columns','exclusions','intent'])&&index(value.offset)&&index(value.rowPage)&&Array.isArray(value.columns)&&value.columns.every(pair)&&new Set(value.columns.map(([i])=>i)).size===value.columns.length&&Array.isArray(value.exclusions)&&value.exclusions.every(item=>exact(item,['row','reason'])&&string(item.row)&&string(item.reason))&&intent(value.intent),
 'plot':value=>exact(value,['offset','plot','base','intent'])&&index(value.offset)&&object(value.plot)&&string(value.plot.title)&&plotMapping(value.plot.mapping)&&object(value.base)&&intent(value.intent),
 'graph-node':value=>exact(value,['origin','offset','item','index','binding','fields'])&&nullableRef(value.origin)&&index(value.offset)&&graphItem(value.item)&&index(value.index)&&(value.binding===null||object(value.binding))&&graphFields(value.fields),
 'uncertainty-input':value=>uncertainty(value)&&string(value.item.name)&&researchId(value.item.id)&&(value.item.estimate===null||statisticalUncertaintyCell(value.item.estimate))&&operand(value.item.sensitivity),
 'uncertainty-covariance':value=>uncertainty(value)&&index(value.item.i)&&index(value.item.j)&&operand(value.item.value),
 'cusum':value=>exact(value,['origin','parameterRef','title','recipe','offset','identity'])&&analytical(value)&&['target','allowance','threshold'].every(key=>scalar(value.recipe[key])),
 'spectrum':value=>exact(value,['origin','parameterRef','title','recipe','offset','identity','methodDraft'])&&analytical(value)&&object(value.recipe.sampling)&&scalar(value.recipe.sampling.origin)&&scalar(value.methodDraft?.step)&&frequencyGrid(value.methodDraft.frequencyGrid)&&(value.recipe.frequencyGrid===undefined||frequencyGrid(value.recipe.frequencyGrid)),
 'local-intake':value=>(exact(value,['source','proposal'])||exact(value,['source','proposal','builder'])&&validBuilder(value.builder))&&string(value.source)&&(value.proposal===null||exact(value.proposal,['id','pin'])&&researchId(value.proposal.id)&&revisionId(value.proposal.pin)),
 'evidence-intake':value=>exact(value,['title','mode','purpose','provenance','selection','intent'])&&string(value.title)&&['folder','files'].includes(value.mode)&&evidencePurposes.includes(value.purpose)&&string(value.provenance)&&(value.selection===null||exact(value.selection,['count','fingerprint'])&&index(value.selection.count)&&value.selection.count>0&&revisionId(value.selection.fingerprint))&&evidenceIntent(value)
};
function uncertainty(value){
 return exact(value,['origin','offset','index','item','execution'])&&nullableRef(value.origin)&&index(value.offset)&&index(value.index)&&object(value.item)&&object(value.execution)&&researchId(value.execution.id)&&researchId(value.execution.jobId);
}
function analytical(value){
 return validMaterialReference(value.origin)&&nullableRef(value.parameterRef)&&string(value.title)&&index(value.offset)&&identity(value.identity)&&recipe(value.recipe);
}
export const scientificEditKinds=Object.freeze(Object.keys(kinds));
function walk(item,depth,refs){
 if(item===null||string(item)||typeof item==='boolean'||Number.isFinite(item))return true;
 if(typeof item!=='object'||depth>64)return false;
 if(Array.isArray(item))return item.every(value=>walk(value,depth+1,refs));
 if(Object.getPrototypeOf(item)!==Object.prototype)return false;
 if(referenceKinds.has(item.kind)&&('revision' in item||'workspaceId' in item)){
  if(!validMaterialReference(item))return false;
  refs?.set(materialReferenceKey(item),materialReference(item));
 }
 for(const key in item)if(opaqueField.test(key)||!walk(item[key],depth+1,refs))return false;
 return true;
}
export function scientificEditReferences(base,value){
 const refs=new Map();walk(base,0,refs);walk(value,0,refs);return [...refs.values()];
}
export function validScientificEdit(kind,value){
 if(!Object.hasOwn(kinds,kind)||!object(value)||!walk(value,0,null))return false;
 if(Object.hasOwn(value,'command')){
  const {command,...pending}=value;
  return ['graph-node','uncertainty-input','uncertainty-covariance'].includes(kind)&&revisionId(command)&&kinds[kind](pending);
 }
 return kinds[kind](value);
}
