import {once} from 'node:events';
import {operationResponse} from './operation-response.js';
import {AppError} from './errors.js';
// Signed review streams share the selected owner's lifetime and cancellation.
export async function reviewHttp(req,res,request,{contextId,body,json,execute}){
 if(request.method!==req.method)throw new AppError('NOT_FOUND');const params=new URL(req.url,'http://localhost').searchParams;
 if(req.method==='GET'?params.get('context')!==contextId:req.headers['x-observanda-workspace']!==contextId)throw new AppError('WORKSPACE_CHANGED');
 if(request.input==='stream'&&req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
 let data;if(request.querySelection){const value=params.get('selection');if(params.getAll('selection').length!==1||!value||value.length>4096)throw new AppError('INVALID');try{data=JSON.parse(value);}catch{throw new AppError('INVALID');}if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');}else data=await body(req,request.limit);
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 const download=async({name,contentType,chunks})=>{
  if(typeof name!=='string'||!['application/octet-stream','image/svg+xml','text/csv; charset=utf-8','application/json; charset=utf-8'].includes(contentType)||typeof chunks?.[Symbol.asyncIterator]!=='function')throw new AppError('INVALID');
  res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));res.setHeader('Content-Type',contentType);res.setHeader('X-Content-Type-Options','nosniff');
  for await(const bytes of chunks){controller.signal.throwIfAborted();if(!res.write(bytes))await once(res,'drain',{signal:controller.signal});}controller.signal.throwIfAborted();res.end();
 };
 const run=options=>execute(data,{...options,signal:controller.signal,stream:req,download});
 try{if(request.download)return await run();if(request.write)return await operationResponse(req,res,run,json);return json(await run());}finally{res.off('close',abort);}
}
