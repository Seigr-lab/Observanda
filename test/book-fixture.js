import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {recordRevision} from '../src/research.js';
import {createRun} from '../src/web/record-workflow.js';
export const block=(kind,attrs)=>({type:'book_'+kind,attrs:{version:1,id:randomUUID(),...attrs}});
export function richBook(){
 const book=upgradeNotebook(sampleNotebook()),[concept,experiment]=book.entries;
 concept.type='concept';concept.share=true;concept.title='Boundary meaning';concept.figures=[];concept.sections=[];concept.attachments=[];
 const table=block('table',{title:'Exact measurements',headers:['Code','Value'],rows:[['105','9007199254740993'],['004','0.000000000000000001']]}),equation=block('equation',{source:String.raw`\frac{x^2}{\sqrt{y}}`,label:'Squared x divided by square root of y'}),citation=block('citation',{title:'Original method source',authors:'A. Researcher',issued:'2025',locator:'Section 4',url:'https://example.org/method'});
 concept.body={type:'doc',content:[{type:'heading',attrs:{level:2,id:randomUUID()},content:[{type:'text',text:'Definition'}]},table,equation,citation,{type:'code_block',attrs:{language:'My apparatus language'},content:[{type:'text',text:'  EMIT 105\n\tFORM 0005  \n'}]}]};
 experiment.type='experiment';experiment.share=true;experiment.title='Named experiment';experiment.relations=[{id:randomUUID(),type:'Uses definition',target:{workspaceId:book.id,kind:'record',id:concept.id,selector:{version:1,kind:'table',id:table.attrs.id}},label:concept.title}];
 return {book,concept,experiment,table,equation,citation};
}
export function journeyBook(){
 const f=richBook(),{book,concept,experiment}=f,method={...structuredClone(concept),id:randomUUID(),type:'protocol',title:'Original method',body:'Original setup instructions',sections:[{id:randomUUID(),title:'Procedure',body:'Use the original settings.'}],relations:[]};
 const exactMethod={workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method),selector:{version:1,kind:'section',id:method.sections[0].id}};
 experiment.relations.push({id:randomUUID(),type:'Uses method',role:'uses-method',target:exactMethod,label:method.title});
 const run1=createRun(book,experiment,{title:'Named experiment — first run'}),run2=createRun(book,experiment,{title:'Named experiment — second run',previous:run1,revision:recordRevision(run1)});
 const result={...structuredClone(method),id:randomUUID(),type:'analysis',title:'Comparison result',body:'Both attempts remain distinct; readings are not additional experiments.',sections:[],relations:[{id:randomUUID(),type:'Compares',role:'compares',target:{workspaceId:book.id,kind:'record',id:run2.id,revision:recordRevision(run2)},label:run2.title}]};
 concept.relations=[{id:randomUUID(),type:'Tested by',target:{workspaceId:book.id,kind:'record',id:experiment.id},label:experiment.title}];
 const privateRecord={...structuredClone(method),id:randomUUID(),sections:[],title:'PRIVATE A7 withheld research',share:false};
 book.entries=[concept,experiment,run1,run2,method,result,privateRecord];
 for(const record of book.entries){record.notebookId=concept.notebookId;record.tags=['a7','bench'];record.occurredOn='2026-10-04';record.share=record!==privateRecord;}
 // Dates/tags are part of the revision: references identify the final snapshots.
 experiment.relations.find(r=>r.role==='uses-method').target.revision=recordRevision(method);
 for(const run of [run1,run2])run.relations.find(r=>r.role==='uses-method').target.revision=recordRevision(method);
 run2.relations.find(r=>r.role==='follows-run').target.revision=recordRevision(run1);
 result.relations[0].target.revision=recordRevision(run2);
 return {...f,method,run1,run2,result,privateRecord};
}
