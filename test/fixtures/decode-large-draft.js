import {createHash,randomUUID} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import {recordCheckpointIdentity} from '../../src/web/record-checkpoint-identity.js';
import {jsonChunks} from '../../src/web/json-chunks.js';
import {readRecordCheckpoint} from '../../src/web/record-draft-transfer.js';
const body='\\'.repeat(60000),record={id:randomUUID(),title:'Recovery',sections:Array.from({length:300},(_,i)=>({id:randomUUID(),title:'Section '+i,body}))};
const changes=[{baseRevision:null,expectedRevision:null,record}],content=await recordCheckpointIdentity(changes),chunks=jsonChunks(changes),id=randomUUID();let received=0,peakHeapMiB=0;
const result=await readRecordCheckpoint(async(route,data)=>{
 peakHeapMiB=Math.max(peakHeapMiB,Math.ceil(process.memoryUsage().heapUsed/1024/1024));
 if(route.endsWith('/read'))return {revision:'a'.repeat(64),draft:{formatVersion:3,id,workspaceId:randomUUID(),count:1,updatedAt:'2026-10-10',content,base:{recordId:record.id,revision:null}}};
 if(route.endsWith('/readBase'))return {base:null};
 if(!route.endsWith('/readPart')||data.index!==received++)throw Error('Invalid read');const chunk=chunks.next();if(chunk.done)throw Error('Early EOF');
 return {bytes:Buffer.from(chunk.value).toString('base64'),sha256:createHash('sha256').update(chunk.value).digest('hex')};
},id);
const sections=result.draft.changes[0].record.sections;
for(const [i,section] of sections.entries())if(section.id!==record.sections[i].id||section.body!==body)throw Error('Lost recovery content');
console.log(JSON.stringify({bytes:content.bytes,sections:sections.length,heapLimit:getHeapStatistics().heap_size_limit,peakHeapMiB}));
