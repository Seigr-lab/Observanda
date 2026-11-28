// Per-owner authoring budgets. Evidence/media/datasets are streamed artifacts,
// not part of these JSON documents. Record count and total catalogue bytes do
// not share the legacy whole-document transport ceiling.
import {jsonByteLength} from './json-chunks.js';
export const MAX_RECORD_BYTES=2*1024*1024;
export const MAX_METADATA_BYTES=2*1024*1024;
// Active multi-record editing has its own budget, independent of saved corpus size.
export const MAX_SELECTED_RECORDS=1000;
export const MAX_SELECTED_RECORD_BYTES=2*1024*1024;
export const MAX_RECORD_COMMAND_BYTES=MAX_SELECTED_RECORD_BYTES+256*1024;

const policies=Object.freeze({
 record:{code:'RECORD_SIZE_LIMIT',limit:MAX_RECORD_BYTES},
 metadata:{code:'WORKSPACE_METADATA_LIMIT',limit:MAX_METADATA_BYTES},
 recordSelection:{code:'RECORD_SELECTION_LIMIT',limit:MAX_SELECTED_RECORD_BYTES},
 recordCommand:{code:'RECORD_COMMAND_LIMIT',limit:MAX_RECORD_COMMAND_BYTES},
 recordCheckpoint:{code:'DRAFT_SIZE_LIMIT',limit:MAX_RECORD_COMMAND_BYTES},
 checkpointRequest:{code:'DRAFT_SIZE_LIMIT',limit:MAX_RECORD_COMMAND_BYTES}
});
export const researchBytes=value=>jsonByteLength(value,{pretty:true})+1;
export function researchCapacityIssue(owner,requestedBytes,{recordId}={}){
 const policy=policies[owner];
 if(!policy||!Number.isSafeInteger(requestedBytes)||requestedBytes<0)throw new TypeError('Invalid research capacity request');
 return requestedBytes<=policy.limit?null:{code:policy.code,details:[{kind:'research-capacity',owner,requestedBytes,limitBytes:policy.limit,...(recordId?{recordId}:{})}]};
}
