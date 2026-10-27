import {AppError} from './errors.js';
import {publicationJobControlRequest} from './publication-job-policy.js';

const controlGet=new Set(['/api/health','/api/access/status','/api/diagnostics','/api/writer-recovery','/api/activity']);
const controlPost=new Set([
 '/api/access/lock','/api/writer-recovery',
 '/api/deployment-jobs/status','/api/deployment-jobs/cancel','/api/repository-setup/status','/api/repository-setup/cancel',
 '/api/media-imports/job','/api/media-imports/cancel','/api/research/materials/job','/api/research/materials/cancel-job',
 '/api/publishing/verification','/api/publishing/verification-cancel','/api/github-connection/cancel',
 '/api/v1/intake/status','/api/v1/intake/cancel','/api/storage/copy/cancel','/api/storage/export/cancel','/api/storage/move/cancel',
 '/api/storage/move/status','/api/storage/delete/status','/api/record-transfer/cancel'
]);
export function requestLane(method,pathname){
 if(method==='POST'&&pathname==='/api/session')return 'bootstrap';
 // Owner prefixes select storage; they do not change the operation's budget.
 const route=pathname.replace(/^\/api\/projects\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/(?:lab-books\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/)?/,'/api/');
 const publication=publicationJobControlRequest(route);if(publication&&publication.method===method)return publication.admission;
 return (method==='GET'?controlGet.has(route):method==='POST'&&controlPost.has(route))?'control':'work';
}
const busy=()=>new AppError('WORKLOAD_BUSY');
const positive=value=>Number.isSafeInteger(value)&&value>0;

// Limits are service-wide, not multiplied by the number of open owners. The
// control lane has its own slots and input budget; work cannot borrow them.
// Byte accounting covers retained encoded JSON until its handler finishes.
// It is not a claim that the JS heap is equal to the encoded input size.
export class RequestAdmission{
 constructor({active=8,queued=16,controlActive=2,controlQueued=4,bytes=128*1024*1024,controlBytes=256*1024,waitMs=5000}={}){
  if(![active,controlActive,bytes,controlBytes,waitMs].every(positive)||![queued,controlQueued].every(value=>Number.isSafeInteger(value)&&value>=0))throw new AppError('INVALID');
  this.waitMs=waitMs;this.closed=false;
  this.lanes={work:{limit:active,maxQueued:queued,maxBytes:bytes,active:0,bytes:0,queue:[]},control:{limit:controlActive,maxQueued:controlQueued,maxBytes:controlBytes,active:0,bytes:0,queue:[]},bootstrap:{limit:1,maxQueued:2,maxBytes:16384,active:0,bytes:0,queue:[]}};
 }
 acquire(name,{signal}={}){
  if(this.closed)throw new AppError('SERVER_CLOSING');signal?.throwIfAborted();
  const lane=this.lanes[name];if(!lane)throw new AppError('INVALID');
  if(lane.active<lane.limit&&!lane.queue.length)return Promise.resolve(this.ticket(lane));
  if(lane.queue.length>=lane.maxQueued)throw busy();
  return new Promise((resolve,reject)=>{
   const entry={resolve,reject,signal};
   const remove=error=>{const index=lane.queue.indexOf(entry);if(index<0)return;lane.queue.splice(index,1);this.clear(entry);reject(error);};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(busy()),this.waitMs);
   lane.queue.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});if(signal?.aborted)entry.abort();
  });
 }
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 ticket(lane){
  lane.active++;let released=false,retained=0;
  return {
   retain(bytes){
    if(released||!Number.isSafeInteger(bytes)||bytes<retained)throw new AppError('INVALID');
    if(lane.bytes+bytes-retained>lane.maxBytes)throw busy();lane.bytes+=bytes-retained;retained=bytes;
   },
   release:()=>{
    if(released)return;released=true;lane.active--;lane.bytes-=retained;
    while(!this.closed&&lane.queue.length&&lane.active<lane.limit){const entry=lane.queue.shift();this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}entry.resolve(this.ticket(lane));}
   }
  };
 }
 close(){this.closed=true;for(const lane of Object.values(this.lanes))for(const entry of lane.queue.splice(0)){this.clear(entry);entry.reject(new AppError('SERVER_CLOSING'));}}
 stats(){return Object.fromEntries(Object.entries(this.lanes).map(([name,lane])=>[name,{active:lane.active,queued:lane.queue.length,retainedBytes:lane.bytes,activeLimit:lane.limit,queueLimit:lane.maxQueued,byteLimit:lane.maxBytes}]));}
}
