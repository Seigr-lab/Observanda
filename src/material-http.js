import {serveContent} from './file-content.js';
import {operationResponse} from './operation-response.js';
import {AppError} from './errors.js';
export async function materialHttp(req,res,request,{contextId,body,json,execute}){
 if(request.method!==req.method)throw new AppError('NOT_FOUND');
 if(req.method==='GET'){
  if(new URL(req.url,'http://localhost').searchParams.get('context')!==contextId)throw new AppError('WORKSPACE_CHANGED');
 }else if(req.headers['x-observanda-workspace']!==undefined&&req.headers['x-observanda-workspace']!==contextId)throw new AppError('WORKSPACE_CHANGED');
 if(request.input==='stream'&&req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
 const data=request.input==='stream'||req.method==='GET'?{}:await body(req,request.limit);
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 const download=async({doc,content})=>{
  res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(doc.content.name));
  await serveContent(req,res,content,'application/octet-stream',{signal:controller.signal});
 };
 const run=options=>execute(data,{...options,signal:controller.signal,stream:req,download});
 try{
  if(request.download)return await run();
  if(request.write&&request.input!=='stream')return await operationResponse(req,res,run,value=>json(value,request.status??200));
  return json(await run(),request.status??200);
 }finally{res.off('close',abort);}
}
