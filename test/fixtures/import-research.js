import {attemptFixture} from './attempts.js';

// Adapter-owned meaning, declared explicitly rather than inferred by product
// code from an arbitrary source's field names.
export function portableResearch(){
 const attempt=attemptFixture({protocols:[{link:0}]});
 attempt.preparations[0].conditions[0].value='105 (base 6)';
 return {format:'observanda-record-facts',version:1,status:'completed',outcome:'Acquisition complete; recognition unresolved',
  template:{id:'run-fields',profileId:null,label:'Apparatus run',description:'Independent criteria and exact source values',
   fields:[{key:'counter',label:'Counter value',type:'text',unit:'ticks',required:true,choices:[]},{key:'expectation',label:'Expected outcome',type:'text',unit:'',required:false,choices:[]}],
   values:{counter:'900719925474099312345',expectation:'Logging and recognition assessed separately'}},attempt,
  results:{version:1,statements:[{id:'conclusion',kind:'conclusion',basis:'authored',source:null,title:'Bounded conclusion',text:'Acquisition alone does not establish recognition.',limitations:'No independent recognition reference was acquired.'}]}};
}
