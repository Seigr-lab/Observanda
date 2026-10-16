import {appendOnlyAttempt,mergeAttemptAdditions} from '../web/attempt-model.js';
import {pointerParts} from './selector-contract.js';

export const validResearchMapping=value=>value===null||value&&Object.keys(value).join()==='path'&&typeof value.path==='string'&&value.path.length<=2048&&pointerParts(value.path)!==null;
export function mergeImportedAttempt(base,incoming,current){
 if(incoming===undefined)return current;
 if(current===undefined)return incoming;
 if(appendOnlyAttempt(current,incoming))return incoming;
 return mergeAttemptAdditions(base,incoming,current);
}
