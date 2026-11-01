import path from 'node:path';
import {withStagingAuthority} from '../../src/staging-reservations.js';
import {temporaryStreamName} from '../../src/storage-temporary.js';
import {writeFilePart} from '../../src/segmented-file-io.js';

const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const {root,id,key,request}=JSON.parse(Buffer.concat(chunks));
const workspace={root,vault:{id,key:Buffer.from(key,'base64')},readMetadata:async()=>null,storageKind:async()=>'catalogue',metadataPage:async()=>({items:[]})};
await withStagingAuthority(workspace,async authority=>{
 const claim=await authority.reserve(request),bytes=Buffer.from('interrupted registered payload');
 await authority.scope.member(path.join(root,'.observanda/collaboration/staging',claim.id,'0.blob'),async(directory,name)=>{
  const temporary=temporaryStreamName(),ticket=await claim.capacity({directory,temporary,name,storedBytes:bytes.length}),file=await directory.file(temporary,{mode:'exclusive'});
  await ticket.created(file);await ticket.write(bytes.length,()=>writeFilePart(file,bytes,0));await file.sync();await file.close();
  // Deliberately leave both an unpublished payload and unacknowledged bytes.
  process.stdout.write('ready');await new Promise(()=>{});
 });
});
