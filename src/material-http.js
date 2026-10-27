import {once} from 'node:events';
import {onResponseClose} from './response-close.js';
import {serveContent} from './file-content.js';
import {operationResponse} from './operation-response.js';
import {AppError} from './errors.js';
export async function materialHttp(req,res,request,{contextId,body,json,execute}){
 if(request.method!==req.method)throw new AppError('NOT_FOUND');
 if(req.method==='GET'){
  if(new URL(req.url,'http://localhost').searchParams.get('context')!==contextId)throw new AppError('WORKSPACE_CHANGED');
 }else if(req.headers['x-observanda-workspace']!==undefined&&req.headers['x-observanda-workspace']!==contextId)throw new AppError('WORKSPACE_CHANGED');
 if(request.input==='stream'&&req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
 let data=request.input==='stream'||req.method==='GET'?{}:await body(req,request.limit);
 if(request.querySelection){
  const parameters=new URL(req.url,'http://localhost').searchParams,selection=parameters.get('selection');
  if(req.method!=='GET'||parameters.getAll('selection').length!==1||!selection||!Number.isSafeInteger(request.limit)||selection.length>request.limit)throw new AppError('INVALID');
  try{data=JSON.parse(selection);}catch{throw new AppError('INVALID');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
 }
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();},releaseClose=onResponseClose(res,abort);
 const download=async({doc,content,name,contentType,chunks})=>{
  if(chunks){
   if(typeof chunks[Symbol.asyncIterator]!=='function'||typeof name!=='string'||!['image/svg+xml','text/csv; charset=utf-8','application/json; charset=utf-8'].includes(contentType))throw new AppError('INVALID');
   res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.setHeader('Content-Type',contentType);res.setHeader('X-Content-Type-Options','nosniff');
   for await(const chunk of chunks){controller.signal.throwIfAborted();if(!res.write(chunk))await once(res,'drain',{signal:controller.signal});}
   controller.signal.throwIfAborted();res.end();return;
  }
  res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(doc.content.name));
  await serveContent(req,res,content,'application/octet-stream',{signal:controller.signal});
 };
 const run=options=>execute(data,{...options,signal:controller.signal,stream:req,download});
 try{
  if(request.download)return await run();
  if(request.progress||request.write&&request.input!=='stream')return await operationResponse(req,res,run,value=>json(value,request.status??200));
  return json(await run(),request.status??200);
 }finally{releaseClose();}
}
