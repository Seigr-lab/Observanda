// Project media and fonts keep their original bytes, policy and processing jobs
// with the same owner as the project that authors or publishes them.
import {WorkspaceFonts} from './workspace-fonts.js';
import {MAX_FONT_BYTES} from './font-inspector.js';
import {MediaStore} from './media.js';
import {MediaImports} from './media-imports.js';
import {MediaPolicy} from './media-policy.js';
import {diskSpace} from './file-content.js';
import {jobSummary} from './jobs.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function projectAssetRequest(route,method='POST'){
 const operation=route.slice(5),font=/^fonts\/(custom-[a-f0-9]{64})$/.exec(operation),media=/^media\/([a-f0-9-]{36})$/.exec(operation),original=/^media-imports\/original\/([a-f0-9-]{36})$/.exec(operation),receive=/^media-imports\/receive\/([a-f0-9-]{36})$/.exec(operation);
 const request=(write,input='json',binary=false)=>({asset:operation,write,input,binary,method,limit:65536});
 if(method==='GET'&&(operation==='fonts'||operation==='media-policy'||font||media&&researchId(media[1])||original&&researchId(original[1])))return request(false,'json',!!(font||media||original));
 if(method==='POST'){
  if(operation==='fonts/import'||/^media\/(image|audio|video|file)$/.test(operation)||receive&&researchId(receive[1]))return request(true,'stream');
  if(['fonts/update','media-policy','media-imports/start','media-imports/finish','media-imports/cancel','media-imports/retry','media-imports/list','media-imports/job'].includes(operation))return request(!['media-imports/list','media-imports/job'].includes(operation));
 }
 return null;
}
export async function executeProjectAsset(storage,request,data,{signal,stream,query,contentLength,binary,jobs}={}){
 const operation=request.asset;signal?.throwIfAborted();
 if(operation==='media-policy'){const policy=new MediaPolicy(storage);return request.method==='GET'?policy.read():policy.save(data.policy,data.etag);}
 if(operation.startsWith('fonts')){
  const fonts=new WorkspaceFonts(storage);
  if(operation==='fonts')return fonts.list();
  if(operation==='fonts/update')return fonts.update(data.id,data);
  if(operation==='fonts/import'){
   if(!['true','false'].includes(query.embed))throw new AppError('INVALID');const chunks=[];let size=0;
   for await(const chunk of stream){signal?.throwIfAborted();size+=chunk.length;if(size>MAX_FONT_BYTES)throw new AppError('FONT_INVALID');chunks.push(chunk);}return fonts.import(Buffer.concat(chunks),{embed:query.embed==='true',signal});
  }
  const font=await fonts.get(operation.slice(6));try{return await binary({content:font.bytes,mime:'font/'+font.faces[0].file.split('.').at(-1)});}finally{font.bytes.fill(0);}
 }
 if(operation.startsWith('media-imports/')){
  const imports=new MediaImports(storage),method=operation.slice(14);
  if(method.startsWith('original/')){const {session,content}=await imports.original(method.slice(9));return binary({content,mime:'application/octet-stream',download:session.name});}
  if(method.startsWith('receive/'))return imports.receive(method.slice(8),stream,{signal});
  if(method==='start')return imports.start(data);
  const owner=await jobs(),{queue,worker}=owner;
  if(method==='list'){const page=await imports.page(data);for(const item of page.items)item.job=jobSummary(await queue.read(item.id));return page;}
  if(method==='finish'){const session=await imports.read(data.id);if(!session.source)throw new AppError('MATERIAL_INCOMPLETE');const job=await queue.enqueue({id:session.id,type:'media.prepare',scope:session.workspaceId,input:{importId:session.id,size:session.size}});worker.wake();return {job:jobSummary(job)};}
  const job=await queue.read(data.id);if(!job||job.type!=='media.prepare')throw new AppError('NOT_FOUND');await queue.authorize(job);if(method==='job')return {job:jobSummary(job)};const next=await queue.control(job.id,method);if(method==='cancel')worker.cancel(job.id);else worker.wake();return {job:jobSummary(next)};
 }
 const media=new MediaStore(storage),id=operation.slice(6);
 if(request.method==='GET'){const asset=await media.get(id,{streamed:true});return binary({content:asset.bytes,mime:asset.mime,...(asset.kind==='file'?{download:asset.name}:{})});}
 const policy=(await new MediaPolicy(storage).read()).policy,size=Number(contentLength??0);
 if(policy.maxUploadBytes&&size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');if(Number.isSafeInteger(size)&&size>0)await diskSpace(storage.root,size,policy.reserveBytes);
 return media.import(stream,id,{signal,name:query.name});
}
