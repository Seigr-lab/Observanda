import assert from 'node:assert/strict';
import {getHeapStatistics} from 'node:v8';
import {createHash} from 'node:crypto';
import {recordEncoding,recordContentRevision} from '../../src/record-encoding.js';
import {digest,serialize} from '../../src/storage-format.js';
import {RecordValueTree} from '../../src/record-value-tree.js';

// The source uses repeated immutable text; materializing its 137 MiB JSON
// representation would exceed this process's 60 MiB heap by more than twice.
const count=1200,body='\\'.repeat(60000)+'\ud800\ud83d\udc1d',record={sections:Array.from({length:count},()=>({body}))};
const nodes=new Map();let maxBlock=0,peakHeap=0;
const storage={async put(kind,value){const encoded=serialize(value),revision=digest(encoded);maxBlock=Math.max(maxBlock,Buffer.byteLength(encoded));nodes.set(kind+':'+revision,encoded);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));}};
const start=performance.now(),root=await new RecordValueTree(storage).retain(record),retainedMs=Math.round(performance.now()-start);
const expected=createHash('sha256');expected.update('{\n  "sections": [\n');
for(let i=0;i<count;i++)expected.update('    {\n      "body": '+JSON.stringify(body)+'\n    }'+(i===count-1?'\n':',\n'));
expected.update('  ]\n}\n');
const result=recordEncoding(record);assert.equal(result.revision,expected.digest('hex'));
const expectedCanonical=createHash('sha256');expectedCanonical.update('{"sections":[');
for(let i=0;i<count;i++)expectedCanonical.update((i?',':'')+'{"body":'+JSON.stringify(body)+'}');expectedCanonical.update(']}');
assert.equal(recordContentRevision(record),expectedCanonical.digest('hex'));
const page=await new RecordValueTree(storage).page(root,['sections'],{offset:1199,limit:1});assert.equal(page.values[0].body,body);assert.equal(page.total,count);
console.log(JSON.stringify({bytes:result.bytes,heapLimit:getHeapStatistics().heap_size_limit,peakHeapMiB:Math.ceil(peakHeap/1024/1024),maxBlock,uniqueBlocks:nodes.size,retainedMs}));
