import pg from 'pg';
import {databaseConfiguration} from './postgres.js';
import {AppError} from './errors.js';
import {selectedWorkspaceReadiness} from './selected-workspace-readiness.js';
import {filesystemPersistence} from './filesystem-persistence.js';

// Two control connections per service process, independent of data-plane
// admission. Health never initializes an owner or makes an integrity claim
// about retained content it has not inspected.
let active=0;
export async function probeDatabaseHealth(env,{timeoutMs=2000,Client=pg.Client,inspect,authorize}={}){
 const scope=inspect?'selected-workspace':'database-connection';
 if(!env)return {scope,state:'not-open',ready:false};
 if(active>=2)return {scope,state:'busy',ready:false,code:'DATABASE_BUSY'};
 active++;const controller=new AbortController();let client,timer;
 const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();void client?.end().catch(()=>{});resolve({scope,state:'unavailable',ready:false,code:'DATABASE_UNAVAILABLE'});},timeoutMs);timer.unref?.();});
 const operation=(async()=>{
 try{
  if(authorize&&!await authorize())throw new AppError('ACCESS_LOCKED');controller.signal.throwIfAborted();
  const configuration=await databaseConfiguration(env,{signal:controller.signal});controller.signal.throwIfAborted();
  client=new Client({...configuration,connectionTimeoutMillis:timeoutMs,query_timeout:timeoutMs,statement_timeout:timeoutMs,application_name:'Observanda readiness'});client.on('error',()=>{});
  await client.connect();controller.signal.throwIfAborted();await client.query('SELECT 1');controller.signal.throwIfAborted();
  const detail=inspect?await inspect(client,{env,signal:controller.signal}):{};controller.signal.throwIfAborted();
  if(authorize&&!await authorize())throw new AppError('ACCESS_LOCKED');controller.signal.throwIfAborted();
  return {scope,state:'ready',ready:true,...detail};
 }catch(error){return {scope,state:controller.signal.aborted?'unavailable':error.code==='READINESS_LIMIT'?'incomplete':error.code==='ACCESS_LOCKED'?'locked':'unavailable',ready:false,code:controller.signal.aborted?'DATABASE_UNAVAILABLE':error instanceof AppError?error.code:'DATABASE_UNAVAILABLE'};}
 finally{try{await client?.end();}catch{}active--;clearTimeout(timer);}
 })();
 // A kernel filesystem operation can outlive cancellation. Return the bounded
 // status, but retain its control slot until the actual operation has drained.
 return Promise.race([operation,deadline]);
}
export async function serviceHealth({root,workspace,locked,authorize,closing=false,provider,env=process.env,probe=probeDatabaseHealth}){
 const environments=provider?provider.healthEnvironments?.(root)??{scratch:null,selected:null}:{scratch:env,selected:root?env:null};
 const checks=new Map(),check=value=>{if(!checks.has(value))checks.set(value,probe(value));return checks.get(value);};
 const [scratch,selected]=await Promise.all([
  check(environments.scratch),
  !root?{scope:'selected-workspace',state:'not-selected',ready:false}:locked?{scope:'selected-workspace',state:'locked',ready:false}:workspace?await probe(environments.selected,{authorize,inspect:(client,options)=>selectedWorkspaceReadiness(workspace,client,options)}):{...await check(environments.selected),scope:'workspace-database'}
 ]);
 return {service:'local-authoring',scope:'service-liveness',ready:!closing,liveness:{ready:!closing},serviceReadiness:{scope:'scratch-dependent-services',ready:!closing&&scratch.ready},scratch,selectedWorkspace:{catalogueIntegrity:'not-checked',...selected},filesystemPersistence:filesystemPersistence(),controlConnections:{active,limit:2}};
}
