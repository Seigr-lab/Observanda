import {randomUUID} from 'node:crypto';
import {ResearchDraftTransfer} from '../../src/research-draft-transfer.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {recordRevision} from '../../src/research.js';
import {digest} from '../../src/storage-format.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../../src/web/record-draft-protocol.js';
export async function retainedDraft(workspace,workspaceId,base,record){
 const transfer=new ResearchDraftTransfer(workspace),id=randomUUID(),revision=base?recordRevision(base):null,bytes=Buffer.from(JSON.stringify([{baseRevision:revision,expectedRevision:revision,record}])),sha256=digest(bytes);
 await transfer.start({id,workspaceId,expectedRevision:null,bytes:bytes.length,sha256});
 for(let at=0;at<bytes.length;at+=SIZE){const part=bytes.subarray(at,at+SIZE);await transfer.part({id,workspaceId,transferHash:sha256,index:at/SIZE,bytes:part.toString('base64'),sha256:digest(part)});}
 await transfer.finish({id,workspaceId,transferHash:sha256});return new ResearchDrafts(workspace).read(id,{header:true});
}
