import assert from 'node:assert/strict';
import {getHeapStatistics} from 'node:v8';
import {researchBytes,researchRequestCapacity} from '../../src/web/research-capacity.js';
import {validateRecordChanges,validateCatalogueMetadata} from '../../src/model.js';

// Shared immutable text keeps the fixture itself small; serialized copies of
// this record are larger than the process heap and must never be constructed.
const section={body:'\\'.repeat(60000)+'\ud800\ud83d\udc1d'},count=1200;
const record={id:'record',sections:Array.from({length:count},()=>section)};
const sample={...record,sections:[section]},two={...record,sections:[section,section]};
const bytes=value=>Buffer.byteLength(JSON.stringify(value,null,2)+'\n');
const expected=bytes(sample)+(count-1)*(bytes(two)-bytes(sample));
const measured=researchBytes(record),issue=researchRequestCapacity('/api/research/records/save',{changes:[{id:record.id,record}]});
assert.equal(measured,expected);assert.equal(issue.details[0].requestedBytes,expected);
assert.throws(()=>validateRecordChanges({},[record],[]),error=>error.code===issue.code&&error.details[0].requestedBytes===expected);
const metadata={formatVersion:21,entries:[],sections:record.sections},metadataBytes=researchBytes(metadata);
assert.throws(()=>validateCatalogueMetadata(metadata),error=>error.code==='WORKSPACE_METADATA_LIMIT'&&error.details[0].requestedBytes===metadataBytes);
console.log(JSON.stringify({measured,heapLimit:getHeapStatistics().heap_size_limit,heapMiB:Math.ceil(process.memoryUsage().heapUsed/1024/1024)}));
