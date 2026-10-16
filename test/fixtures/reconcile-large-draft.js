import {getHeapStatistics} from 'node:v8';
import {reconcileRecords} from '../../src/web/record-merge.js';
const body='\\'.repeat(60000),count=480;
const record=prefix=>({id:'record',title:'Many observations',body:'',sections:Array.from({length:count},(_,i)=>({id:'section-'+i,title:prefix+i,body})),notebookId:'book',share:false});
const base=record('Original '),mine=record('Local '),stored=record('Saved '),plan=reconcileRecords([{base,record:mine}],[stored],{owned:true});
const planningHeapMiB=Math.ceil(process.memoryUsage().heapUsed/1024/1024),choices=new Map(plan.conflicts.map((c,i)=>[c.key,{version:i%2?'mine':'stored'}]));
const [result]=plan.resolveVersions(choices);
for(const [i,section] of result.sections.entries())if(section.body!==body||section.title!==(i%2?'Local ':'Saved ')+i||section.id!=='section-'+i)throw Error('Lost chosen content');
console.log(JSON.stringify({sections:result.sections.length,conflicts:plan.conflicts.length,encodedBodyBytes:count*body.length*2,heapLimit:getHeapStatistics().heap_size_limit,planningHeapMiB,finalHeapMiB:Math.ceil(process.memoryUsage().heapUsed/1024/1024)}));
