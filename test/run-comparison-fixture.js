import {randomUUID} from 'node:crypto';
import {runFixture} from './run-fixture.js';
import {preparation,event,assessment} from './fixtures/attempts.js';
export function runComparisonFixture({heavy=false}={}){
 const data=runFixture(2,1),run=data.runs[0],p=preparation(),q={...preparation(),supersedes:p.id,reason:'Later configuration',applicability:'Latest configuration'};
 const events=Array.from({length:11},(_,i)=>event(i%2?p:q,{label:'Acquisition '+i})),assessments=Array.from({length:11},(_,i)=>assessment(i%2?p:q,i%2,{observed:'Observation '+i}));
 events.push({...events[0],id:randomUUID(),supersedes:events[0].id,reason:'Corrected receipt',label:'Reviewed acquisition zero'});
 assessments.push({...assessments[0],id:randomUUID(),supersedes:assessments[0].id,reason:'Corrected interpretation',observed:'Reviewed observation zero'});
 run.attempt={version:1,preparations:[p,q],events,assessments};
 const method=run.relations.find(r=>r.role==='uses-method');for(let i=1;i<11;i++)run.relations.push({...structuredClone(method),id:randomUUID(),label:'Method context '+i});
 if(heavy)run.sections.push(...Array.from({length:71},(_,i)=>({id:randomUUID(),title:'Other narrative '+i,body:'Private unselected prose '.repeat(1100)})));
 return data;
}
