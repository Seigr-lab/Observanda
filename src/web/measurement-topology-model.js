import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export class MeasurementTopologyError extends Error{constructor(code='MEASUREMENT_TOPOLOGY_INVALID'){super(code);this.code=code;}}
export const TOPOLOGY_CODEC='observanda.topology';
export const TOPOLOGY_PAGE_SIZE=16;
export const TOPOLOGY_OPERATIONS=Object.freeze(['counts','degree','neighbors','reachable','reachability']);
export const topologyCount=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
// Keys are literal identities. Validation never trims, normalizes, case-folds or
// interprets valid text; whitespace-only keys and Unicode controls are refused.
export const validTopologyKey=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim().length>0&&value.isWellFormed()&&!/\p{Cc}/u.test(value);
export function validTopologyDefinition(value){return exact(value,['version','codec','codecVersion','namespace','direction','loops','parallelEdges','resourcePolicy'])&&value.version===4&&value.codec===TOPOLOGY_CODEC&&value.codecVersion===1&&validTopologyKey(value.namespace)&&['directed','undirected'].includes(value.direction)&&['allow','reject'].includes(value.loops)&&['allow','reject'].includes(value.parallelEdges)&&!!validDatasetResourcePolicy(value.resourcePolicy);}
export const validTopologyVertex=value=>exact(value,['key'])&&validTopologyKey(value.key);
export const validTopologyEdge=value=>exact(value,['key','from','to'])&&['key','from','to'].every(key=>validTopologyKey(value[key]));
export function sameTopologySpace(left,right){return validTopologyDefinition(left)&&validTopologyDefinition(right)&&['namespace','direction','loops','parallelEdges'].every(key=>left[key]===right[key]);}
export function topologyDirectionAllowed(definition,direction){return validTopologyDefinition(definition)&&['in','out','all'].includes(direction)&&(definition.direction==='directed'||direction==='all');}
export function validTopologyOperation(value){
 if(!value||!TOPOLOGY_OPERATIONS.includes(value.kind))return false;if(value.kind==='counts')return exact(value,['kind']);
 if(!['in','out','all'].includes(value.direction))return false;
 if(value.kind==='degree')return exact(value,['kind','vertex','direction'])&&validTopologyKey(value.vertex);
 if(value.kind==='reachable')return exact(value,['kind','from','to','direction'])&&validTopologyKey(value.from)&&validTopologyKey(value.to);
 return exact(value,['kind',value.kind==='neighbors'?'vertex':'from','direction','offset','limit'])&&validTopologyKey(value[value.kind==='neighbors'?'vertex':'from'])&&topologyCount(value.offset)&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=TOPOLOGY_PAGE_SIZE;
}
// topology.namespace owns the authored vertex-key identities. A structural
// result uses a separate sequence declaration in that same namespace, never a
// topology definition, material ID or inferred physical/circuit meaning.
export function topologyVertexSequenceDefinition(definition){if(!validTopologyDefinition(definition))throw new MeasurementTopologyError();return {version:4,codec:'observanda.sequence',codecVersion:1,namespace:definition.namespace,element:{kind:'symbol'},resourcePolicy:structuredClone(definition.resourcePolicy)};}
// Storage owner contract:
// authored JSON {vertices:[{key}],edges:[{key,from,to}]} is streamed in authored
// order. Envelope5 is the closed sibling variant
// {format:'domain-value',version:5,definition,original,
//  topology:{version:1,vertices:<topology-vertices sequence>,
//            edges:<topology-edges sequence>},identity,complete:true}.
// Both descriptors use existing immutable MaterialSequence storage, bounded
// chunks and exact descriptor counts; empty roots are real empty values.
// Older declaration/envelope generations remain opaque and unchanged.

// Whole derived vertex sequences use the same literal key and direction rules.
// Paging remains a separate inspection operation and never truncates a result.
export function validTopologySequenceOperation(value){return !!value&&['neighbors','reachability'].includes(value.kind)&&exact(value,['kind',value.kind==='neighbors'?'vertex':'from','direction'])&&validTopologyKey(value[value.kind==='neighbors'?'vertex':'from'])&&['in','out','all'].includes(value.direction);}

export function validTopologyGraphOperation(value){if(value?.kind==='count')return exact(value,['kind','collection'])&&['vertices','edges'].includes(value.collection);return validTopologySequenceOperation(value)||['degree','reachable'].includes(value?.kind)&&validTopologyOperation(value);}
