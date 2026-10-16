import {randomUUID} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import {inspectRecordDraft} from '../../src/record-draft-inspection.js';

const record={id:randomUUID(),notebookId:randomUUID(),type:'note',title:'Large draft',body:'',contributors:[],relations:[],tags:[],occurredOn:'2026-10-10',createdAt:'',updatedAt:'',share:false,figures:[],status:'draft',attachments:[]};
const sections=2200;let bytes=0,peakHeap=0;
async function* input(){
 const prefix='[{"baseRevision":null,"expectedRevision":null,"record":'+JSON.stringify(record).slice(0,-1)+',"sections":[';
 bytes+=Buffer.byteLength(prefix);yield Buffer.from(prefix);
 for(let index=0;index<sections;index++){
  const chunk=Buffer.from((index?',':'')+JSON.stringify({id:randomUUID(),title:'Observation '+index,body:'x'.repeat(60000)}));bytes+=chunk.length;yield chunk;
  peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
 }
 bytes+=4;yield Buffer.from(']}}]');
}
const result=await inspectRecordDraft(input());if(result.base.recordId!==record.id)throw Error('Wrong record identity');
console.log(JSON.stringify({bytes,sections,heapLimit:getHeapStatistics().heap_size_limit,peakHeapMiB:Math.ceil(peakHeap/1024/1024),title:result.title}));
