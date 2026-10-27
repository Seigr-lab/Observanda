import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {zipStream} from './zip-stream.js';
import {publicationText} from './web/publication-messages.js';
import {AppError} from './errors.js';

// Authorization stays with the owner. Checking an immutable edition can take
// longer than the socket idle limit; disconnecting cancels only this download.
export async function publicationExportHttp(req,res,prepare){
 const socket=req.socket,timeout=socket.timeout,controller=new AbortController();
 const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);res.setTimeout(0);
 const activity=req.operationActivity?.(),onProgress=value=>activity?.progress(value);
 try{
  onProgress({stage:publicationText('exportPreparing'),completed:0,unit:'items'});
  const files=await prepare({signal:controller.signal,onProgress});controller.signal.throwIfAborted();
  res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="observanda-site.zip"'});
  let completed=0,last=0;
  async function* output(){for await(const chunk of zipStream(files)){controller.signal.throwIfAborted();completed+=chunk.byteLength;const now=Date.now();if(now-last>=250){last=now;onProgress({stage:publicationText('exportDownloading'),completed,unit:'bytes'});}yield chunk;}}
  await pipeline(Readable.from(output()),res,{signal:controller.signal});
  onProgress({stage:publicationText('exportDownloading'),completed,unit:'bytes'});activity?.finish();
 }catch(error){activity?.finish(controller.signal.aborted?new AppError('WRITE_CANCELLED'):error);throw error;}
 finally{res.off('close',abort);if(!socket.destroyed)socket.setTimeout(timeout??60000);}
}
