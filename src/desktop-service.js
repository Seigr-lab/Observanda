// The desktop window runs the existing HTTP app in a bundled Node process.
// There is no renderer-to-Node bridge or separate desktop workspace model.
import path from 'node:path';
import {startWorkspaceDatabases} from './workspace-databases.js';
import {startServer} from './server.js';
import {readPreference} from './locations.js';
import {DeviceStore} from './security/device-store.js';
import {AppError,safeError} from './errors.js';
let runtime,server,starting=false,stopping=false,closed;const startup=new AbortController(),pending=new Map();let sequence=0;
const send=message=>{if(process.connected)process.send(message);};
const protector={available:()=>true,protect:bytes=>transform('encrypt',bytes.toString('base64')).then(value=>Buffer.from(value,'base64')),unprotect:bytes=>transform('decrypt',bytes.toString('base64')).then(value=>Buffer.from(value,'base64'))};
function transform(operation,value){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new AppError('DEVICE_UNAVAILABLE'));},15000);pending.set(id,{resolve,reject,timer});send({type:'protect',id,operation,value});});}
async function stop(){
 stopping=true;startup.abort();if(starting)return;
 return closed??=(async()=>{
  let failure;
  try{await server?.close();}catch(error){failure=error;}
  // A failed HTTP shutdown must not strand any workspace, project or book
  // database. The manager drains every owner before the service disconnects.
  try{await runtime?.close();}catch(error){failure??=error;}
  finally{
   if(failure){process.exitCode=1;console.error(safeError(failure).message);}
   for(const item of pending.values()){clearTimeout(item.timer);item.reject(new AppError('DEVICE_UNAVAILABLE'));}
   pending.clear();if(process.connected)process.disconnect();
  }
 })();
}
process.on('disconnect',()=>void stop());process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
process.on('message',async message=>{
  if(message?.type==='shutdown-status'&&Number.isSafeInteger(message.id)){send({type:'shutdown-status',id:message.id,...(server?.shutdownStatus()??{busy:starting||stopping,failure:0})});return;}
  if(message?.type==='protected'){const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new AppError('DEVICE_UNAVAILABLE')):item.resolve(message.value);}return;}
  if(message?.type==='stop'){void stop();return;}
  if(message?.type!=='start'||starting||runtime||stopping)return;
  if(typeof message.preferencesFile!=='string'||!path.isAbsolute(message.preferencesFile))return;
  starting=true;
  try{
    runtime=await startWorkspaceDatabases({directory:path.join(path.dirname(message.preferencesFile),'postgresql'),signal:startup.signal,onProgress:({stage,percent})=>send({type:'progress',message:stage==='download'?'Preparing database: '+percent+'%':({install:'Preparing the database…',extract:'Checking the database runtime…',initialize:'Preparing your private database…',start:'Starting your database…'})[stage]??'Starting Observanda…'})});
    startup.signal.throwIfAborted();const root=await readPreference(message.preferencesFile);
    const deviceStore=new DeviceStore({file:message.preferencesFile+'.device-key',...(process.platform==='darwin'&&message.deviceProtection?{protector}:{})});
    server=await startServer({root,port:0,preferencesFile:message.preferencesFile,expectedExisting:!!root,deviceStore});
    startup.signal.throwIfAborted();send({type:'ready',url:server.url});
  }catch(error){if(!stopping)send({type:'failed',message:safeError(error).message});stopping=true;process.exitCode=1;}
  finally{starting=false;if(stopping)await stop();}
});
if(!process.connected){console.error('Start Observanda from its desktop application.');process.exitCode=1;}
