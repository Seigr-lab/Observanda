// Bounded authoring commands identify existing members; document roots and source
// receipts are always resolved by the server. Limits here bound one edit only.
import {validRetainedFigureOperation} from './retained-figure-presentation-model.js';
import {researchId} from './research-reference.js';
import {validMaterialReference} from './material-reference.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
import {FIGURE_TYPES} from './figure-model.js';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed,required=allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e100;
const text=value=>typeof value==='string'&&value.length<=16384&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const pointFields=['x','y','error',...INTERVAL_FIELDS,'count'];
const coordinate=value=>value===null||finite(value)||text(value);
export function validAuthoredPointPatch(patch){
 if(!exact(patch,pointFields,[])||!Object.keys(patch).length)return false;
 for(const [key,value]of Object.entries(patch)){
  if(['x','xLower','xUpper'].includes(key)){if(!coordinate(value))return false;}
  else if(key==='count'){if(value!==null&&!natural(value))return false;}
  else if(value!==null&&(!finite(value)||key==='error'&&value<0))return false;
 }
 return true;
}
export function validManualFigureOperation(value){
 if(validRetainedFigureOperation(value)){try{return new TextEncoder().encode(JSON.stringify(value)).length<=65536;}catch{return false;}}
 if(!object(value)||!['points','series','panels'].includes(value.collection)||value.plotId!==undefined&&!researchId(value.plotId))return false;
 const scope=['type','collection','id','plotId'];
 if(value.type==='patch')return value.collection==='points'&&exact(value,[...scope,'patch'])&&researchId(value.id)&&researchId(value.plotId)&&validAuthoredPointPatch(value.patch);
 if(value.type==='text')return value.collection==='points'&&exact(value,[...scope,'field','offset','remove','text'])&&researchId(value.id)&&researchId(value.plotId)&&value.field==='x'&&natural(value.offset)&&natural(value.remove)&&text(value.text);
 if(value.type==='remove')return exact(value,scope,value.collection==='panels'?['type','collection','id']:scope)&&researchId(value.id)&&(value.collection==='panels'||researchId(value.plotId));
 if(value.type==='move')return exact(value,[...scope,'direction'],value.collection==='panels'?['type','collection','id','direction']:[...scope,'direction'])&&researchId(value.id)&&[-1,1].includes(value.direction)&&(value.collection==='panels'||researchId(value.plotId));
 if(value.type==='append'){
  if(value.collection==='points')return exact(value,[...scope,'seriesId','value'],['type','collection','plotId','seriesId','value'])&&value.id===undefined&&researchId(value.plotId)&&researchId(value.seriesId)&&exact(value.value,pointFields,['x','y','error'])&&validAuthoredPointPatch(value.value);
  if(value.collection==='series')return exact(value,[...scope,'value'],['type','collection','plotId','value'])&&value.id===undefined&&researchId(value.plotId)&&exact(value.value,['name','color'])&&text(value.value.name)&&!!value.value.name.trim()&&/^#[0-9a-f]{6}$/i.test(value.value.color);
  return exact(value,['type','collection','value'])&&exact(value.value,['label','kind','xKind'])&&text(value.value.label)&&!!value.value.label.trim()&&FIGURE_TYPES.some(([kind])=>kind===value.value.kind)&&['number','date','category'].includes(value.value.xKind);
 }
 return false;
}
export const validManualFigureImport=value=>exact(value,['source','mode','plotId'],['source','mode'])&&validMaterialReference(value.source)&&value.source.kind==='analysis'&&['replace','append','panel'].includes(value.mode)&&(value.mode==='append'?researchId(value.plotId):value.plotId===undefined||researchId(value.plotId));
// An authored edit never retains the claim that its changed coordinates are the
// original source measurement. The containing revision pins the prior source.
export function authoredPointValue(point,patch){
 if(!object(point)||!validAuthoredPointPatch(patch))throw Error('Invalid measurement edit.');
 const {source,...value}=point;void source;return {...value,...patch};
}

// Authored figures can combine exact observations from multiple analyses.
// Their private receipts retain the original analysis/member identity; clients
// never provide these bindings in authoring commands.
export const validAuthoredPointOrigin=value=>object(value)&&validMaterialReference(value.ref)&&value.ref.kind==='analysis'&&(exact(value,['ref','index'])&&natural(value.index)||exact(value,['ref','seriesId','pointId'])&&researchId(value.seriesId)&&researchId(value.pointId));
