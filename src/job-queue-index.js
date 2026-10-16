// Pending jobs and lease deadlines have independently indexed membership. The
// shared authenticated metadata tree owns paging, integrity and atomic writes.
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
const root='.observanda/jobs',file=root+'/queue.json';
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const ordinal=value=>Number.isSafeInteger(value)&&value>=0;
const deadline=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
const padded=value=>String(value).padStart(16,'0');
const active=job=>['queued','running'].includes(job.state);
export class JobQueueIndex{
 constructor(workspace,readJob){this.workspace=workspace;this.readJob=readJob;}
 async json(name,limit=4096){const raw=await this.workspace.readMetadata(name,limit);if(raw===null)return null;try{const value=JSON.parse(raw);if(value===null)fail();return value;}catch{fail();}}
 async put(name,value){await this.workspace.writeMetadata(name,JSON.stringify(value));}
 async head(){
  const value=await this.json(file,65536);
  if(value===null)return {format:2,count:0,next:0};
  // This bounded array is read only to upgrade old installations atomically.
  if(Array.isArray(value)){if(value.length>512||value.some(id=>!researchId(id))||new Set(value).size!==value.length)fail();return {legacy:value};}
  if(value.format!==2||!ordinal(value.count)||!ordinal(value.next)||value.count>value.next)fail();return value;
 }
 path(member){return member.until===null?root+'/pending/'+padded(member.ticket)+'-'+member.id+'.json':root+'/leases/'+padded(Math.ceil(member.until))+'-'+padded(member.ticket)+'-'+member.id+'.json';}
 memberFile(id){if(!researchId(id))fail();return root+'/members/'+id+'.json';}
 valid(member){return member&&researchId(member.id)&&ordinal(member.ticket)&&typeof member.type==='string'&&!!member.type&&member.type.length<=100&&(member.until===null||deadline(member.until));}
 async member(id){const value=await this.json(this.memberFile(id));if(value!==null&&(!this.valid(value)||value.id!==id))fail();return value;}
 async typeCount(type){const value=await this.json(root+'/types/'+digest(type)+'.json');if(value!==null&&(value.type!==type||!ordinal(value.count)||!value.count))fail();return value?.count??0;}
 async changeType(type,delta){const count=await this.typeCount(type)+delta;if(!ordinal(count))fail();const name=root+'/types/'+digest(type)+'.json';if(count)await this.put(name,{type,count});else await this.workspace.removeMetadata(name);}
 async ensure(){
  const head=await this.head();if(!head.legacy)return head;
  const next={format:2,count:0,next:0};
  for(const id of head.legacy){const job=await this.readJob(id);if(!job||!active(job))fail();await this.insert(job,next);}
  await this.put(file,next);return next;
 }
 async insert(job,head){
  if(!ordinal(head.next+1)||!ordinal(head.count+1)||!active(job)||await this.member(job.id))fail();
  const member={id:job.id,ticket:head.next++,type:job.type,until:job.state==='running'?job.lease.until:null};if(!this.valid(member))fail();
  await this.put(this.memberFile(job.id),member);await this.put(this.path(member),member);await this.changeType(job.type,1);head.count++;
 }
 // Called in the same writer transaction as the job document. Queue pointers
 // cannot survive a refused commit or refer to an unaccepted command.
 async update(job){
  const head=await this.ensure(),member=await this.member(job.id);
  if(!active(job)){
   if(!member)return;
   if(member.type!==job.type||!head.count)fail();
   await this.workspace.removeMetadata(this.path(member));await this.workspace.removeMetadata(this.memberFile(job.id));await this.changeType(job.type,-1);head.count--;
  }else if(!member){if(job.state!=='queued')fail();await this.insert(job,head);}
  else{
   if(member.type!==job.type)fail();const next={...member,until:job.state==='running'?job.lease.until:null};if(!this.valid(next))fail();
   if(next.until!==member.until){await this.workspace.removeMetadata(this.path(member));await this.put(this.path(next),next);await this.put(this.memberFile(job.id),next);}
  }
  await this.put(file,head);
 }
 async first(bucket){
  const page=await this.workspace.metadataPage(root+'/'+bucket,{limit:1});if(!page.items.length)return null;
  const row=page.items[0];let member;try{member=JSON.parse(row.text);}catch{fail();}
  if(!this.valid(member)||this.path(member)!==root+'/'+bucket+'/'+row.name)fail();
  const current=await this.member(member.id);if(!current||['id','ticket','type','until'].some(key=>current[key]!==member[key]))fail();return member;
 }
 async candidate(now){
  const head=await this.head();
  if(head.legacy){for(const id of head.legacy){const job=await this.readJob(id);if(!job||!active(job))fail();if(job.state==='queued'||job.lease.until<=now)return id;}return null;}
  if(!head.count)return null;
  // An expired lease is recoverable work. Future leases never require scanning
  // every running job before accepting another pending command.
  const leased=await this.first('leases');if(leased&&leased.until<=now)return leased.id;
  const pending=await this.first('pending');if(!leased&&!pending)fail();return pending?.id??null;
 }
 async has(types=null){
  const head=await this.head();if(head.legacy){if(!types)return head.legacy.length>0;for(const id of head.legacy){const job=await this.readJob(id);if(!job||!active(job))fail();if(types.includes(job.type))return true;}return false;}
  if(!types)return head.count>0;for(const type of types)if(await this.typeCount(type))return true;return false;
 }
 async status(){const head=await this.head();return {active:head.legacy?.length??head.count};}
}
