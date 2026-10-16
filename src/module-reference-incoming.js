import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {ModuleReader} from './modules/reader.js';
import {moduleDomainOf} from './modules/domains.js';
import {uuid} from './modules/validation.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
const referenceValid=value=>value&&Object.keys(value).sort().join()==='id,type,workspaceId'&&uuid(value.workspaceId)&&uuid(value.id)&&(['record','project','notebook'].includes(value.type)||moduleDomainOf(value.type));
const key=reference=>[reference.workspaceId,reference.type,reference.id].join('/');
const order=(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return x<y?-1:x>y?1:a.key<b.key?-1:a.key>b.key?1:0;};
const point=row=>({key:row.key,title:row.title});
// Incoming links contain source summaries only. Qualified identities never
// make the target a participant in a source writer or copy its content.
export async function moduleReferenceIncoming(pages,client,command,{visit,collectionWorkspaceId,resolveTarget,check=async()=>{},signal}){
 const {workspaceId,target,types=null,query='',cursor=null,limit=25}=command;
 if(!uuid(workspaceId)||!uuid(collectionWorkspaceId)||!referenceValid(target)||types!==null&&(!Array.isArray(types)||types.length>40||new Set(types).size!==types.length||!types.every(moduleDomainOf))||typeof query!=='string'||query.length>256||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>8192))throw new AppError('INVALID');
 await check();signal?.throwIfAborted();
 return resolveTarget(target,async(_storage,canonical,{store})=>{
  if(!referenceValid(canonical)||canonical.type!==target.type||canonical.id!==target.id)throw new AppError('MODULE_REFERENCE');
  const referenceNamespaces=canonical.type==='record'?await recordReferenceNamespaces(store,canonical):[canonical.workspaceId];
  const signature=digest(JSON.stringify({kind:'module-incoming',workspaceId,collectionWorkspaceId,target,canonical,referenceNamespaces,types,query,limit})),session=pages.begin(client,signature,cursor),snapshots={},unavailable=[];let unavailableTotal=0;
  const domains=types===null?null:[...new Set(types.map(moduleDomainOf).concat(types.includes('booking')?['inventory']:[]))].sort();
  const page=summaryPage({offset:session.offset,after:session.after,limit,order,point});
  const retain=(id,revision)=>{
   if(Object.hasOwn(snapshots,id)||session.snapshots&&session.snapshots[id]!==revision)throw new AppError('RECORD_QUERY_CURSOR');snapshots[id]=revision;
  };
  await visit(async(storage,address)=>{
   signal?.throwIfAborted();
   const source=new ModuleReader(storage,{domains});
   await source.context(address.workspaceId,async context=>{
    if(context.book.id!==address.workspaceId)throw new AppError('DATABASE_LOCATION');
    retain(address.workspaceId,context.head.revision);
    const reader=new ModuleReader(storage,{context:(_id,consume)=>consume(context)}),owner={workspaceId:address.workspaceId,projectId:address.projectId??null,labBookId:address.labBookId??null,projectTitle:address.projectTitle??'',notebookTitle:address.labBookId?context.book.notebooks.find(book=>book.id===address.labBookId)?.title??'':''};
    await reader.list({workspaceId:address.workspaceId,types,reference:canonical,query,limit:1},{signal,referenceNamespaces,collect:view=>{
     const reference={workspaceId:address.workspaceId,type:view.type,id:view.id};
     page.add({...view,key:key(reference),reference,owner});
    }});
   });
  },{workspaceId:collectionWorkspaceId,scope:null,signal,onUnavailable:async(error,address)=>{
   // Only the visitor decides that an owner was unavailable before admission.
   // A prior admitted owner's revocation remains a failed request.
   retain(address.workspaceId,'unavailable:'+error.code);
   if(++unavailableTotal<=25)unavailable.push({workspaceId:address.workspaceId,projectId:address.projectId??null,labBookId:address.labBookId??null,code:error.code});
  }});
  if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
  await check();signal?.throwIfAborted();const result=page.finish(),encode=pages.retain(session,snapshots),offset=session.offset,next=offset+result.records.length;
  return {workspaceId,target,items:result.records,total:result.total,offset,cursor:encode(offset,session.after),nextCursor:next<result.total?encode(next,result.after):null,previousCursor:offset?encode(Math.max(0,offset-limit),result.previousAfter):null,partial:unavailableTotal>0,unavailableTotal,unavailable};
 });
}
