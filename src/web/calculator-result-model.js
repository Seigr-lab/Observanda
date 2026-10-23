import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validMaterialReference} from './material-reference.js';
import {STRUCTURED_CALCULATION_ENGINE} from './tools/structured-calculation-model.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
export const CALCULATOR_RECIPE_TOOL='Observanda calculator recipe';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const text=v=>typeof v==='string'&&v.length>0&&v.length<=2000&&!/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const validCalculatorSource=v=>exact(v,['workspaceId','type','id','revision'])&&researchId(v.workspaceId)&&v.type==='calculation'&&researchId(v.id)&&Number.isSafeInteger(v.revision)&&v.revision>0;
export function validCalculatorRecipe(v){const structured=v?.version===2;return exact(v,['version','scope','source','expressionIndex','expression','engine','angle','policy','library',...(structured?['structuredEngine']:[])])&&[1,2].includes(v.version)&&v.scope==='selected-expression'&&exact(v.source,['workspaceId','type','id','revision','entityHash'])&&validCalculatorSource(Object.fromEntries(Object.entries(v.source).filter(([key])=>key!=='entityHash')))&&revisionId(v.source.entityHash)&&Number.isSafeInteger(v.expressionIndex)&&v.expressionIndex>=0&&v.expressionIndex<100&&text(v.expression)&&(structured?v.engine===4:[2,3].includes(v.engine))&&['rad','deg'].includes(v.angle)&&(v.engine>=3?validCalculationPolicy(v.policy)&&v.policy.version===(structured?2:1):v.policy===null)&&exact(v.library,['name','version'])&&v.library.name==='mathjs'&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.library.version)&&(v.engine<3||v.library.version===v.policy.library.version)&&(!structured||exact(v.structuredEngine,['name','version'])&&v.structuredEngine.name===STRUCTURED_CALCULATION_ENGINE.name&&v.structuredEngine.version===STRUCTURED_CALCULATION_ENGINE.version);}
export const validCalculatorResult=v=>exact(v,['version','recipe'])&&[1,2].includes(v.version)&&validMaterialReference(v.recipe)&&v.recipe.kind==='analysis';
export const isCalculatorRecipe=content=>content?.tool===CALCULATOR_RECIPE_TOOL&&['1','2'].includes(content.version)&&content.recipe?.version===Number(content.version);
export const calculatorResultMaterial=value=>value?.content?.tool===CALCULATOR_RECIPE_TOOL&&value.content.recipe!==undefined||value?.content?.calculatorResult!==undefined;
export const calculatorResultMetadata=(relative,value)=>calculatorResultMaterial(value)||relative.startsWith('.observanda/jobs/')&&value?.input?.command?.calculatorResult!==undefined;
