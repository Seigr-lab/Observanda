import pg from 'pg';
import {databaseConfiguration} from './postgres.js';
import {AppError} from './errors.js';

// Two control connections per service process, independent of data-plane
// admission. Health never initializes an owner, authenticates a catalogue or
// makes an integrity claim about research it has not inspected.
let active=0;
export async function probeDatabaseHealth(env,{timeoutMs=2000,Client=pg.Client}={}){
 if(!env)return {scope:'database-connection',state:'not-open',ready:false};
 if(active>=2)return {scope:'database-connection',state:'busy',ready:false,code:'DATABASE_BUSY'};
 active++;const controller=new AbortController();let client;
 const timer=setTimeout(()=>{controller.abort();void client?.end().catch(()=>{});},timeoutMs);timer.unref?.();
 try{
  const configuration=await databaseConfiguration(env,{signal:controller.signal});controller.signal.throwIfAborted();
  client=new Client({...configuration,connectionTimeoutMillis:timeoutMs,query_timeout:timeoutMs,statement_timeout:timeoutMs,application_name:'Observanda readiness'});client.on('error',()=>{});
  await client.connect();controller.signal.throwIfAborted();await client.query('SELECT 1');controller.signal.throwIfAborted();
  return {scope:'database-connection',state:'ready',ready:true};
 }catch(error){return {scope:'database-connection',state:'unavailable',ready:false,code:controller.signal.aborted?'DATABASE_UNAVAILABLE':error instanceof AppError?error.code:'DATABASE_UNAVAILABLE'};}
 finally{clearTimeout(timer);try{await client?.end();}catch{}active--;}
}
export async function serviceHealth({root,locked,closing=false,provider,env=process.env,probe=probeDatabaseHealth}){
 const environments=provider?provider.healthEnvironments?.(root)??{scratch:null,selected:null}:{scratch:env,selected:root?env:null};
 const checks=new Map(),check=value=>{if(!checks.has(value))checks.set(value,probe(value));return checks.get(value);};
 const [scratch,selected]=await Promise.all([
  check(environments.scratch),
  !root?{scope:'workspace-database',state:'not-selected',ready:false}:locked?{scope:'workspace-database',state:'locked',ready:false}:{...await check(environments.selected),scope:'workspace-database'}
 ]);
 return {service:'local-authoring',scope:'service-liveness',ready:!closing,liveness:{ready:!closing},scratch,selectedWorkspace:{...selected,catalogueIntegrity:'not-checked'},controlConnections:{active,limit:2}};
}
