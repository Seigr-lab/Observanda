// Calculation lists belong to their record. Rebuild their small discovery
// entries from the accepted job rather than copying a workspace-wide list.
import {MetadataFeed} from './metadata-feed.js';
import {projectCommandJobs} from './project-job-ownership.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const root='metadata:.observanda/dataset-jobs/',hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('JOB_DAMAGED');};
export const projectJobDiscoveryKey=key=>/^metadata:\.observanda\/dataset-jobs\/([a-f0-9-]{36})(-order\.json|\/([a-f0-9-]{36})\.json|-order\/(\d{13}-([a-f0-9-]{36})\.json))$/.exec(key);
const summary=job=>({id:job.id,createdAt:job.createdAt,...(job.input.command.title===undefined?{}:{title:job.input.command.title})});
export async function projectJobDiscoveryOwner(store,queue,record,key){
 if(!key.startsWith(root))return null;const match=projectJobDiscoveryKey(key);if(!match)damaged();const [,recordId,suffix,id,,orderedId]=match;
 const raw=await store.object(key);let value;try{value=JSON.parse(raw.text);}catch{damaged();}
 if(suffix==='-order.json'){if(hash(value)!==hash({version:1}))damaged();}
 else{
  const job=await queue.read(id??orderedId);if(!job||!projectCommandJobs.has(job.type)||job.scope!==recordId||job.input.command?.recordId!==recordId)damaged();
  const expected=id?summary(job):{id:job.id,createdAt:job.createdAt};if(hash(value)!==hash(expected))damaged();
  if(orderedId&&match[4]!==new MetadataFeed(store.workspace,'.observanda/dataset-jobs/'+recordId).key(job))damaged();
 }
 return record(recordId);
}
export async function migrateProjectJobDiscovery(to,job,parts){
 if(!projectCommandJobs.has(job.type))return;const feed=new MetadataFeed(to.workspace,'.observanda/dataset-jobs/'+job.scope);
 await parts.metadata(feed.source+'/'+job.id+'.json',summary(job));await parts.metadata(feed.order+'/'+feed.key(job),{id:job.id,createdAt:job.createdAt});await parts.metadata(feed.marker,{version:1});
}
