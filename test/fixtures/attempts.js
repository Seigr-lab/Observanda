import {randomUUID} from 'node:crypto';
import {emptyAttempt} from '../../src/web/attempt-model.js';
export const attemptStamp='2026-10-04T12:00:00.000Z';
export const fact=()=>({id:randomUUID(),supersedes:null,recordedAt:attemptStamp,reason:''});
export function preparation({protocols=[]}={}){
 return {...fact(),applicability:'This attempt, before acquisition',basedOn:null,protocols,
  conditions:[{id:randomUUID(),name:'Window size',value:'120',unit:'samples',basis:'stated',reference:null,reason:'Declared configuration, not a measurement'}],
  inputs:[{id:randomUUID(),label:'Source build',kind:'source',algorithm:'sha256',hash:'b'.repeat(64),reference:null}],
  observations:[{id:randomUUID(),label:'Acquire native log and inspect recognition separately'}],
  criteria:[{id:randomUUID(),label:'Native logging',expected:'Every returned native record decodes',comparator:'Independent decoder reports no invalid records',denominator:'All acquired native records',scope:'prospective',reason:''},
   {id:randomUUID(),label:'Recognition',expected:'Requested pattern recognized',comparator:'Compare against independent reference',denominator:'One physical attempt',scope:'prospective',reason:''}]};
}
export function event(prep,changes={}){
 return {...fact(),preparationId:prep?.id??null,kind:'acquired',label:'Return copied',extent:'complete',context:'host',circumstances:'',actor:'Synthetic operator',source:'Acquisition receipt',time:{meaning:'device-counter',value:'10000000000000001 (declared base 6)'},references:[],...changes};
}
export function assessment(prep,criterion=0,changes={}){
 return {...fact(),preparationId:prep.id,criterionId:prep.criteria[criterion].id,outcome:criterion?'unresolved':'met',domainOutcome:'',observed:criterion?'Reference observation unavailable':'All acquired records decoded',denominator:criterion?'One physical attempt':'246 native records',actor:'Synthetic reviewer',source:'Independent review',time:{meaning:'unknown',value:''},reason:criterion?'Logging alone does not establish recognition':'Reviewed against native bytes',references:[],...changes};
}
export function attemptFixture(options){const p=preparation(options);return {...emptyAttempt(),preparations:[p],events:[event(p),event(p,{kind:'executing',context:'physical',extent:'partial',circumstances:'Reused medium; no additional attempt inferred'})],assessments:[assessment(p),assessment(p,1)]};}
