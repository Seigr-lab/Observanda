// A managed server is ready only when its application role can use the owned
// database. Cold database startup has a separate, bounded readiness budget.
import {Socket} from 'node:net';
import {Client} from 'pg';
import {AppError} from './errors.js';
export async function verifyManagedApplication(config,{signal}={}){
 if(signal?.aborted)throw new AppError('DATABASE_CANCELLED');
 const socket=new Socket(),client=new Client({stream:socket,host:'127.0.0.1',port:config.port,user:'observanda',password:config.appPassword,database:'observanda',connectionTimeoutMillis:30000,statement_timeout:30000,application_name:'Observanda startup'});
 client.on('error',()=>{});const abort=()=>socket.destroy(new AppError('DATABASE_CANCELLED'));
 signal?.addEventListener('abort',abort,{once:true});
 try{
  signal?.throwIfAborted();await client.connect();signal?.throwIfAborted();
  const result=await client.query("SELECT current_database() AS database, current_user AS role, current_setting('transaction_read_only') AS read_only");
  if(result.rows.length!==1||result.rows[0].database!=='observanda'||result.rows[0].role!=='observanda'||result.rows[0].read_only!=='off')throw new AppError('DATABASE_RUNTIME');
  signal?.throwIfAborted();
 }catch{throw new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_RUNTIME');}
 finally{try{await client.end();}finally{signal?.removeEventListener('abort',abort);socket.destroy();}}
}
