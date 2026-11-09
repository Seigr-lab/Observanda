import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {contentHash,contentSize} from './file-content.js';
import {LocalExportManifest} from './local-export-manifest.js';
import {researchId} from './web/research-reference.js';

// Deliberate review of a saved website edition. A request names one exact
// release: the identity of the files that would be published. Decisions stay
// attached to that release, so any later change leaves them visibly stale.
// Comments hold only what reviewers write and an element address; context is
// read from the current page, so withdrawn material never reappears here.
const key='.observanda/website-review.json',sizeLimit=4*1024*1024;
export const reviewLimits={requests:100,comments:2000,replies:50,body:4000,note:2000,name:120,reviewers:12,commentsPage:40};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const layer=value=>typeof value==='string'&&value.length<=200&&/^\d+(?:\/\d+)*$/.test(value);
const pagePath=value=>typeof value==='string'&&value.length<=1024&&value.endsWith('.html')&&!value.startsWith('/')&&!value.includes('\\');
const text=(value,limit)=>typeof value==='string'&&value.length<=limit;
const when=value=>Number.isFinite(Date.parse(value));
const decisions=new Set(['approved','changes']);

function validActor(actor){return !!actor&&['user','workspace'].includes(actor.kind)&&(actor.kind==='workspace'?actor.label===undefined:text(actor.label,reviewLimits.name)&&actor.label.length>0);}
const sameActor=(a,b)=>a.kind===b.kind&&(a.label??null)===(b.label??null);
function validState(value){
 if(value?.version!==1||!value.settings||typeof value.settings.requireApproval!=='boolean'||!Array.isArray(value.requests)||!Array.isArray(value.comments))return false;
 if(value.requests.length>reviewLimits.requests||value.comments.length>reviewLimits.comments)return false;
 for(const request of value.requests){
  if(!researchId(request.id)||!hash(request.releaseId)||!hash(request.revision)||!validActor(request.by)||!when(request.at)||!text(request.note,reviewLimits.note))return false;
  if(!Array.isArray(request.reviewers)||request.reviewers.length>reviewLimits.reviewers||request.reviewers.some(name=>!text(name,reviewLimits.name)||!name))return false;
  if(request.files!==null&&(typeof request.files!=='object'||request.files.type!=='files'))return false;
  if(request.closed!==null&&!(request.closed&&when(request.closed.at)&&validActor(request.closed.by)))return false;
  if(!Array.isArray(request.decisions)||request.decisions.some(d=>!decisions.has(d.decision)||!validActor(d.by)||!when(d.at)||!text(d.note,reviewLimits.note)))return false;
 }
 for(const comment of value.comments){
  if(!researchId(comment.id)||!pagePath(comment.path)||!layer(comment.anchor?.path)||!text(comment.anchor.tag,40)||comment.anchor.fingerprint!==null&&!hash(comment.anchor.fingerprint))return false;
  if(comment.request!==null&&!researchId(comment.request)||!validActor(comment.by)||!when(comment.at)||!text(comment.body,reviewLimits.body)||!comment.body.trim())return false;
  if(comment.assignee!==null&&!text(comment.assignee,reviewLimits.name)||comment.resolved!==null&&!(validActor(comment.resolved.by)&&when(comment.resolved.at)))return false;
  if(!Array.isArray(comment.replies)||comment.replies.length>reviewLimits.replies||comment.replies.some(r=>!validActor(r.by)||!when(r.at)||!text(r.body,reviewLimits.body)||!r.body.trim()))return false;
 }
 return true;
}
const emptyState=()=>({version:1,settings:{requireApproval:false},requests:[],comments:[]});
export async function readReviewState(metadata){
 const raw=await metadata.readMetadata(key,sizeLimit);if(!raw)return emptyState();
 let value;try{value=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
 if(!validState(value))throw new AppError('JOB_DAMAGED');
 return value;
}
async function writeReviewState(metadata,value){
 if(!validState(value))throw new AppError('INVALID');
 const raw=JSON.stringify(value);if(Buffer.byteLength(raw)>sizeLimit)throw new AppError('LIMIT');
 await metadata.writeMetadata(key,raw);
}
// A request is open until a later request supersedes it or it is withdrawn.
// Its latest decision describes it; an approval of an earlier edition than the
// current one is stale.
export function requestStatus(request,currentRelease){
 const latest=request.decisions.at(-1);
 const state=request.closed?'closed':latest?.decision==='approved'?'approved':latest?.decision==='changes'?'changes':'open';
 return {state,stale:request.releaseId!==currentRelease};
}
// The gate is satisfied only by an approval of exactly this release, given by
// someone other than the requester when both are identified people.
export function approvalFor(state,releaseId){
 return state.requests.find(request=>{
  if(request.closed||request.releaseId!==releaseId)return false;
  const latest=request.decisions.at(-1);
  if(latest?.decision!=='approved')return false;
  return !(request.by.kind==='user'&&latest.by.kind==='user'&&sameActor(request.by,latest.by));
 })??null;
}
export async function assertPublicationApproval(metadata,candidate){
 if(candidate.edition==='withdrawal')return;
 const state=await readReviewState(metadata);
 if(state.settings.requireApproval&&!approvalFor(state,candidate.id))throw new AppError('WEBSITE_APPROVAL_REQUIRED');
}

async function candidateFiles(metadata,candidate){
 const builder=new LocalExportManifest(metadata).builder('files');
 for(const [path,content] of candidate.files)await builder.append({path,bytes:contentSize(content),sha256:contentHash(content)});
 return builder.finish();
}
async function changes(metadata,request,candidate){
 if(!request.files)return null;
 const current=new Map([...candidate.files].map(([path,content])=>[path,contentHash(content)]));
 const counts={added:0,changed:0,removed:0},samples={added:[],changed:[],removed:[]},seen=new Set();
 const note=(kind,path)=>{counts[kind]++;if(samples[kind].length<40)samples[kind].push(path);};
 for await(const row of new LocalExportManifest(metadata).entries(request.files)){
  seen.add(row.path);const sha=current.get(row.path);
  if(sha===undefined)note('removed',row.path);else if(sha!==row.sha256)note('changed',row.path);
 }
 for(const path of current.keys())if(!seen.has(path))note('added',path);
 return {counts,samples};
}
function view(state,candidate,path,offset){
 const comments=state.comments.filter(comment=>comment.path===path),window=comments.slice(offset,offset+reviewLimits.commentsPage);
 const open=state.comments.filter(comment=>!comment.resolved);
 return {releaseId:candidate.id,revision:candidate.revision,settings:state.settings,approved:!!approvalFor(state,candidate.id),
  requests:state.requests.slice(0,20).map(request=>{const {files,...row}=request;return {...row,...requestStatus(request,candidate.id)};}),
  comments:window,total:comments.length,offset,next:offset+window.length<comments.length?offset+window.length:null,
  openComments:open.length,openOnPage:open.filter(comment=>comment.path===path).length};
}

export async function websiteReview(metadata,candidate,{operation,actor,path='index.html',offset=0,...options}){
 if(!validActor(actor)||!pagePath(path)||!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 const now=()=>new Date().toISOString();
 if(operation==='read')return view(await readReviewState(metadata),candidate,path,offset);
 if(operation==='changes'){
  const state=await readReviewState(metadata),request=state.requests.find(row=>row.id===options.id);
  if(!request)throw new AppError('NOT_FOUND');
  return {id:request.id,releaseId:request.releaseId,current:request.releaseId===candidate.id,changes:await changes(metadata,request,candidate)};
 }
 return metadata.withLock(async()=>{
  const state=await readReviewState(metadata);
  if(operation==='settings'){
   if(typeof options.requireApproval!=='boolean')throw new AppError('INVALID');
   state.settings={requireApproval:options.requireApproval};
  }else if(operation==='request'){
   const note=String(options.note??'').trim(),reviewers=[...new Set((options.reviewers??[]).map(name=>String(name).trim()).filter(Boolean))];
   if(!text(note,reviewLimits.note)||reviewers.length>reviewLimits.reviewers||reviewers.some(name=>!text(name,reviewLimits.name)))throw new AppError('INVALID');
   // A new request for the same edition supersedes the open one; earlier
   // editions keep their decisions as history.
   for(const request of state.requests)if(!request.closed&&request.releaseId===candidate.id)request.closed={by:actor,at:now()};
   const files=await candidateFiles(metadata,candidate);
   state.requests=[{id:randomUUID(),releaseId:candidate.id,revision:candidate.revision,by:actor,at:now(),note,reviewers,files,closed:null,decisions:[]},...state.requests].slice(0,reviewLimits.requests);
  }else if(operation==='decide'){
   const request=state.requests.find(row=>row.id===options.id),note=String(options.note??'').trim();
   if(!request||request.closed)throw new AppError('NOT_FOUND');
   if(!decisions.has(options.decision)||!text(note,reviewLimits.note))throw new AppError('INVALID');
   // A decision applies only to the edition that is current now.
   if(request.releaseId!==candidate.id)throw new AppError('STALE');
   request.decisions.push({decision:options.decision,by:actor,at:now(),note});
  }else if(operation==='withdraw-request'){
   const request=state.requests.find(row=>row.id===options.id);
   if(!request||request.closed)throw new AppError('NOT_FOUND');request.closed={by:actor,at:now()};
  }else if(operation==='comment'){
   const body=String(options.body??'').trim(),anchor=options.anchor;
   if(!body||!text(body,reviewLimits.body)||!anchor||!layer(anchor.path)||!text(anchor.tag,40)||anchor.fingerprint!==null&&!hash(anchor.fingerprint))throw new AppError('INVALID');
   const request=state.requests.find(row=>!row.closed&&row.releaseId===candidate.id)??null;
   if(state.comments.length>=reviewLimits.comments){
    const oldest=state.comments.findLastIndex(comment=>comment.resolved);if(oldest<0)throw new AppError('LIMIT');state.comments.splice(oldest,1);
   }
   state.comments=[{id:randomUUID(),path,anchor:{path:anchor.path,tag:anchor.tag,fingerprint:anchor.fingerprint},request:request?.id??null,by:actor,at:now(),body,assignee:null,resolved:null,replies:[]},...state.comments];
  }else if(['reply','resolve','reopen','assign'].includes(operation)){
   const comment=state.comments.find(row=>row.id===options.id);if(!comment)throw new AppError('NOT_FOUND');
   if(operation==='reply'){
    const body=String(options.body??'').trim();
    if(!body||!text(body,reviewLimits.body)||comment.replies.length>=reviewLimits.replies)throw new AppError(body?'LIMIT':'INVALID');
    comment.replies.push({by:actor,at:now(),body});
   }else if(operation==='resolve')comment.resolved={by:actor,at:now()};
   else if(operation==='reopen')comment.resolved=null;
   else{
    const assignee=String(options.assignee??'').trim();
    if(!text(assignee,reviewLimits.name))throw new AppError('INVALID');comment.assignee=assignee||null;
   }
  }else throw new AppError('NOT_FOUND');
  await writeReviewState(metadata,state);
  return view(state,candidate,path,offset);
 });
}
