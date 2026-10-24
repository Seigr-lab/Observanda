// New recipes may explicitly separate whole-job accounting from bounded
// numerical slices. Historical scalar/calculator policies keep their scopes.
import {datasetResourceLimits,defaultDatasetResourcePolicy,DatasetResourceError} from './dataset-resource-policy.js';
import {policyLimits,defaultStructuredCalculationPolicy} from './tools/calculation-policy.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const natural=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const active=value=>Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER&&!Object.is(value,-0);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const identity=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const immutable=value=>freeze(structuredClone(value));
export class NumericalExecutionError extends Error{constructor(){super('Invalid numerical execution policy, state or transition.');this.code='NUMERICAL_EXECUTION_INVALID';}}
const fail=()=>{throw new NumericalExecutionError();};
export const numericalExecutionLimits=freeze({total:{maxOperations:[...datasetResourceLimits.maxOperations],maxActiveMilliseconds:[...datasetResourceLimits.maxMilliseconds]},slice:{maxOperations:[...policyLimits.maxOperations],maxActiveMilliseconds:[...policyLimits.maxMilliseconds]}});
export function defaultNumericalExecutionPolicy(){const scalar=defaultDatasetResourcePolicy().resources,calculation=defaultStructuredCalculationPolicy().resources;return {version:1,scope:'numerical-job',total:{maxOperations:scalar.maxOperations,maxActiveMilliseconds:scalar.maxMilliseconds},slice:{maxOperations:Math.min(scalar.maxOperations,calculation.maxOperations),maxActiveMilliseconds:Math.min(scalar.maxMilliseconds,calculation.maxMilliseconds)}};}
export function validNumericalExecutionPolicy(value){return exact(value,['version','scope','total','slice'])&&value.version===1&&value.scope==='numerical-job'&&['total','slice'].every(scope=>exact(value[scope],['maxOperations','maxActiveMilliseconds'])&&Object.entries(numericalExecutionLimits[scope]).every(([key,[min,max]])=>Number.isSafeInteger(value[scope][key])&&value[scope][key]>=min&&value[scope][key]<=max))&&Object.keys(value.total).every(key=>value.slice[key]<=value.total[key]);}
const samePolicy=(a,b)=>validNumericalExecutionPolicy(a)&&validNumericalExecutionPolicy(b)&&a.version===b.version&&a.scope===b.scope&&['total','slice'].every(scope=>Object.keys(a[scope]).every(key=>a[scope][key]===b[scope][key]));
export function validNumericalExecutionState(value){
 if(!exact(value,['version','identity','policy','sequence','consumed','reservation'])||value.version!==1||!identity(value.identity)||!validNumericalExecutionPolicy(value.policy)||!natural(value.sequence)||!exact(value.consumed,['operations','activeMilliseconds'])||!natural(value.consumed.operations)||value.consumed.operations>value.policy.total.maxOperations||!active(value.consumed.activeMilliseconds))return false;
 if(value.sequence===0&&(value.consumed.operations!==0||value.consumed.activeMilliseconds!==0||value.reservation!==null))return false;
 const reserved=value.reservation;if(reserved===null)return true;
 return exact(reserved,['id','sequence','operations','activeMilliseconds'])&&uuid(reserved.id)&&reserved.sequence===value.sequence&&reserved.sequence>0&&Number.isSafeInteger(reserved.operations)&&reserved.operations>=1&&reserved.operations<=value.policy.slice.maxOperations&&Number.isSafeInteger(reserved.activeMilliseconds)&&reserved.activeMilliseconds>=1&&reserved.activeMilliseconds<=value.policy.slice.maxActiveMilliseconds&&value.consumed.operations+reserved.operations<=value.policy.total.maxOperations&&value.consumed.activeMilliseconds+reserved.activeMilliseconds<=value.policy.total.maxActiveMilliseconds;
}
export function validateNumericalExecutionState(state,{identity:expectedIdentity,policy:expectedPolicy}={}){if(!validNumericalExecutionState(state)||expectedIdentity!==undefined&&state.identity!==expectedIdentity||expectedPolicy!==undefined&&!samePolicy(state.policy,expectedPolicy))fail();return state;}
export function createNumericalExecutionState(commandIdentity,policy){if(!identity(commandIdentity)||!validNumericalExecutionPolicy(policy))fail();return immutable({version:1,identity:commandIdentity,policy,sequence:0,consumed:{operations:0,activeMilliseconds:0},reservation:null});}
// The owner must authenticate its current checkpoint, fence this transition by
// its lease/current revision, then persist it BEFORE starting the slice.
export function reserveNumericalExecution(state,request){
 validateNumericalExecutionState(state);if(!exact(request,['id','operations','activeMilliseconds'])||!uuid(request.id)||!Number.isSafeInteger(request.operations)||request.operations<1||request.operations>state.policy.slice.maxOperations||!Number.isSafeInteger(request.activeMilliseconds)||request.activeMilliseconds<1||request.activeMilliseconds>state.policy.slice.maxActiveMilliseconds||state.reservation!==null||state.sequence===Number.MAX_SAFE_INTEGER)fail();
 if(state.consumed.operations+request.operations>state.policy.total.maxOperations||state.consumed.activeMilliseconds+request.activeMilliseconds>state.policy.total.maxActiveMilliseconds)throw new DatasetResourceError();
 return immutable({...state,sequence:state.sequence+1,reservation:{id:request.id,sequence:state.sequence+1,operations:request.operations,activeMilliseconds:request.activeMilliseconds}});
}
// Known synchronous work can overrun a cooperative timer before control returns.
// Record that actual time, including an overrun; never cap it or refund it. An
// exhausted total cannot reserve another slice. No result is authorized here.
export function settleNumericalExecution(state,usage){
 validateNumericalExecutionState(state);const reserved=state.reservation;
 if(!reserved||!exact(usage,['id','sequence','operations','activeMilliseconds'])||usage.id!==reserved.id||usage.sequence!==reserved.sequence||!natural(usage.operations)||usage.operations>reserved.operations||!active(usage.activeMilliseconds)||!active(state.consumed.activeMilliseconds+usage.activeMilliseconds))fail();
 return immutable({...state,consumed:{operations:state.consumed.operations+usage.operations,activeMilliseconds:state.consumed.activeMilliseconds+usage.activeMilliseconds},reservation:null});
}
// After interruption an outstanding slice has no trustworthy actual-use receipt.
// Charge its complete reservation before any retry; never settle unknown work
// as zero. A late receipt cannot settle a recovered or newer reservation.
export function recoverNumericalExecution(state){
 validateNumericalExecutionState(state);if(!state.reservation)return immutable(state);
 const reserved=state.reservation;return settleNumericalExecution(state,{id:reserved.id,sequence:reserved.sequence,operations:reserved.operations,activeMilliseconds:reserved.activeMilliseconds});
}
