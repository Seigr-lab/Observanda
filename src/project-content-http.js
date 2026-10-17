import {websiteRequestContext} from './website-request-context.js';
// HTTP transport for explicitly owned content, assets and template packages.
import {serveContent} from './file-content.js';
import {zipStream} from './zip-stream.js';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {operationResponse} from './operation-response.js';
import {AppError} from './errors.js';
export async function projectContentHttp(req,res,request,{body,json,mime,execute,headless,contextId}){
 if(request.method!==req.method)throw new AppError('NOT_FOUND');
 if(request.input==='stream'&&req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
 const url=new URL(req.url,'http://localhost'),data=request.input==='stream'?{}:req.method==='GET'?{...(url.searchParams.has('rollbackReview')?{rollbackReview:url.searchParams.get('rollbackReview')}:{})}:await body(req,request.limit);
 if(req.method==='GET'&&!request.binary&&req.headers['x-observanda-workspace']!==contextId||['workspace','context'].some(key=>url.searchParams.has(key)&&url.searchParams.get(key)!==contextId))throw new AppError('WORKSPACE_CHANGED');
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 const binary=async({archive,name,content,stream,mime:contentType,download})=>{
  if(stream){
   try{
    const first=await stream.next();controller.signal.throwIfAborted();
    res.writeHead(200,{'Content-Type':contentType,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(download)});
    async function* output(){if(!first.done)yield first.value;yield* stream;}
    await pipeline(Readable.from(output()),res,{signal:controller.signal});return;
   }finally{await stream.return?.();}
  }
  if(download)res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(download));
  if(!archive)return serveContent(req,res,content,contentType??mime(name),{signal:controller.signal});
  res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="observanda-site.zip"'});await pipeline(Readable.from(zipStream(archive)),res,{signal:controller.signal});
 };
 const run=options=>execute(data,{...options,signal:controller.signal,stream:req,query:Object.fromEntries(url.searchParams),contentLength:req.headers['content-length'],headless,...websiteRequestContext(req.headers),binary});
 try{if(request.binary)return await run();if(request.write&&request.input!=='stream')return await operationResponse(req,res,run,json);return json(await run());}finally{res.off('close',abort);}
}
