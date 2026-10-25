// A server statement timeout cannot arrive over a stalled transport. Bound the
// whole response as well, and close the connection before releasing its caller.
import {databaseRequestSignal} from './database-request-context.js';
import {AppError} from './errors.js';
export const DATABASE_STATEMENT_TIMEOUT_MS=30000;
export const DATABASE_RESPONSE_TIMEOUT_MS=DATABASE_STATEMENT_TIMEOUT_MS+5000;

export const databaseConnectionEnded=client=>client._ending===true||client._ended===true||client._queryable===false;

export async function databaseQuery(client,sql,values,{signal=databaseRequestSignal()}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  let settled=false,timer;
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const finish=(error,value)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve(value);};
  const stop=reason=>{
   if(settled)return;settled=true;cleanup();
   // pg.end() alone can close gracefully if an ErrorResponse has cleared
   // activeQuery while ReadyForQuery is lost. Destroy the stream even in that
   // state; never enqueue cleanup behind a missing reply or retry COMMIT.
   let closing;try{closing=client.end();}catch{reject(reason);return;}
   finally{client.connection?.stream?.destroy();}
   Promise.resolve(closing).catch(()=>{}).then(()=>reject(reason));
  };
  const abort=()=>stop(signal.reason);
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>stop(new AppError('DATABASE_UNAVAILABLE')),DATABASE_RESPONSE_TIMEOUT_MS);timer.unref?.();
  try{Promise.resolve(client.query(sql,values)).then(value=>finish(null,value),error=>finish(error));}
  catch(error){finish(error);}
  if(signal?.aborted)abort();
 });
}
