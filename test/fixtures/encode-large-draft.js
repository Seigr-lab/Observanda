import {createHash,randomUUID} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import {writeRecordCheckpoint} from '../../src/web/record-draft-transfer.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../../src/web/record-draft-protocol.js';
// The selected editor object is intentionally already resident. This test
// isolates additional transport memory, not full-record editor scalability.
const body='x'.repeat(60000),record={id:randomUUID(),title:'Large draft',sections:Array.from({length:2200},(_,i)=>({id:randomUUID(),title:'Observation '+i,body}))};
const command={id:randomUUID(),workspaceId:randomUUID(),expectedRevision:null,changes:[{baseRevision:null,expectedRevision:null,record}]};
let declared,bytes=0,parts=0,maxRequestBytes=0,peakHeapMiB=0;const hash=createHash('sha256');
const result=await writeRecordCheckpoint(async(route,data)=>{
 maxRequestBytes=Math.max(maxRequestBytes,Buffer.byteLength(JSON.stringify(data)));peakHeapMiB=Math.max(peakHeapMiB,Math.ceil(process.memoryUsage().heapUsed/1024/1024));
 if(route.endsWith('/start')){declared=data;return {receivedChunks:0};}
 if(route.endsWith('/part')){
  const chunk=Buffer.from(data.bytes,'base64');if(data.index!==parts++||chunk.length!==Math.min(SIZE,declared.bytes-bytes)||createHash('sha256').update(chunk).digest('hex')!==data.sha256)throw Error('Invalid chunk');
  hash.update(chunk);bytes+=chunk.length;return {index:data.index};
 }
 if(!route.endsWith('/finish')||bytes!==declared.bytes||hash.digest('hex')!==declared.sha256)throw Error('Incomplete checkpoint');
 return {revision:declared.sha256};
},command);
if(result.revision!==declared.sha256)throw Error('Wrong receipt');
console.log(JSON.stringify({bytes,parts,heapLimit:getHeapStatistics().heap_size_limit,peakHeapMiB,maxRequestBytes}));
