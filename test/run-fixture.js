import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {recordRevision} from '../src/research.js';
import {createRun} from '../src/web/record-workflow.js';
export function runFixture(count=23,unrelated=5){
 const book=upgradeNotebook(sampleNotebook()),source=book.entries[0];
 const record=(title,type='note')=>({...structuredClone(source),id:randomUUID(),type,title,body:'',sections:[],relations:[],figures:[],attachments:[],share:false});
 const parent=record('Surface study','experiment'),method=record('Lighting procedure','protocol');
 parent.relations=[{id:randomUUID(),type:'Uses method',role:'uses-method',label:method.title,target:{workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method)}}];
 book.entries=[parent,method];const runs=[];
 for(let i=0;i<count;i++){
  const run=createRun(book,parent);run.title='Trial '+String(i+1).padStart(3,'0');run.occurredOn=new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10);
  run.status=i===1?'incomplete':'completed';run.outcome=i===1?'Acquisition interrupted':'Observed result';
  run.sections.find(s=>s.title==='Parameters and conditions').body='Light level '+i;
  run.sections.find(s=>s.title==='Purpose and planned changes').body='Change sample '+i;
  run.sections.find(s=>s.title==='Results').body='Private full raw results '+i;
  runs.push(run);book.entries.push(run);
 }
 // A run that merely mentions the study does not belong to its run series.
 const incidental=createRun(book,parent);incidental.relations=incidental.relations.filter(link=>link.role!=='run-of');
 incidental.relations.push({id:randomUUID(),type:'Discusses',label:parent.title,target:{workspaceId:book.id,kind:'record',id:parent.id}});book.entries.push(incidental);
 for(let i=0;i<unrelated;i++)book.entries.push(record('Unrelated record '+i));
 return {book,parent,method,runs,incidental};
}
