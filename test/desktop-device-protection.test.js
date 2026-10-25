import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import path from 'node:path';
import {deviceProtectionAvailable,protectDeviceValue} from '../desktop/policy.js';

function storage(){
 const state={available:true,backend:'gnome_libsecret',calls:[]};
 const api={isEncryptionAvailable(){state.calls.push('available');return state.available;},getSelectedStorageBackend(){state.calls.push('backend');return state.backend;},
  encryptString(value){state.calls.push(['encrypt',value]);return Buffer.from('sealed:'+value);},decryptString(value){state.calls.push(['decrypt',value.toString()]);return value.toString().slice(7);},
  setUsePlainTextEncryption(){assert.fail('Plain-text fallback must never be enabled');}};
 return {state,api};
}
test('Linux desktop protection admits only available known secure OS backends',()=>{
 const {state,api}=storage();
 for(const backend of ['gnome_libsecret','kwallet','kwallet5','kwallet6']){state.backend=backend;assert.equal(deviceProtectionAvailable(api,'linux'),true,backend);}
 for(const backend of ['basic_text','unknown','future_backend','',null,undefined,true]){state.backend=backend;assert.equal(deviceProtectionAvailable(api,'linux'),false,String(backend));}
 state.backend='gnome_libsecret';
 for(const available of [false,undefined,null,1,'true']){state.available=available;assert.equal(deviceProtectionAvailable(api,'linux'),false);}
 state.available=true;
 assert.equal(deviceProtectionAvailable({...api,getSelectedStorageBackend:undefined},'linux'),false);
 for(const method of ['isEncryptionAvailable','getSelectedStorageBackend'])assert.equal(deviceProtectionAvailable({...api,[method](){throw Error('Unavailable');}},'linux'),false);
 assert.equal(deviceProtectionAvailable(null,'linux'),false);
 assert.equal(deviceProtectionAvailable({isEncryptionAvailable:()=>true},'darwin'),true,'macOS needs no Linux backend API');
 for(const platform of ['win32','freebsd',undefined])assert.equal(deviceProtectionAvailable(api,platform??'unsupported'),false,'Windows keeps its native protector');
});
test('protection requests recheck backend and availability, preserve limits and reject unsupported operations',()=>{
 const {state,api}=storage(),value=Buffer.from('synthetic private bytes').toString('base64');
 assert.equal(deviceProtectionAvailable(api,'linux'),true);
 const sealed=protectDeviceValue(api,{operation:'encrypt',value},'linux');
 assert.equal(protectDeviceValue(api,{operation:'decrypt',value:sealed},'linux'),value);
 assert.equal(state.calls.filter(value=>value==='available').length,3);
 assert.equal(state.calls.filter(value=>value==='backend').length,3);
 for(const backend of ['basic_text','unknown']){
  state.backend=backend;state.calls=[];
  for(const operation of ['encrypt','decrypt'])assert.equal(protectDeviceValue(api,{operation,value},'linux'),undefined);
  assert.ok(state.calls.every(value=>typeof value==='string'),'Rejected backend never reaches cryptography');
 }
 state.backend='gnome_libsecret';state.available=false;state.calls=[];
 assert.equal(protectDeviceValue(api,{operation:'decrypt',value:sealed},'linux'),undefined);
 assert.deepEqual(state.calls,['available']);state.available=true;
 assert.equal(typeof protectDeviceValue(api,{operation:'encrypt',value:'x'.repeat(32768)},'linux'),'string');
 state.calls=[];
 for(const message of [{operation:'encrypt',value:'x'.repeat(32769)},{operation:'encrypt',value:Buffer.from('bytes')},{operation:'other',value},{value},null])assert.equal(protectDeviceValue(api,message,'linux'),undefined);
 assert.deepEqual(state.calls,[]);
 for(const method of ['encryptString','decryptString'])assert.equal(protectDeviceValue({...api,[method](){throw Error('Keyring failed');}},{operation:method==='encryptString'?'encrypt':'decrypt',value},'linux'),undefined);
 assert.equal(protectDeviceValue(api,{operation:'encrypt',value},'win32'),undefined);
 assert.equal(protectDeviceValue(api,{operation:'decrypt',value:sealed},'darwin'),value);
});

test('real desktop service uses the bridge only for exact startup admission on Linux and macOS',async()=>{
 const service=new URL('../src/desktop-service.js',import.meta.url),source=readFileSync(service,'utf8'),key='__observandaDeviceServiceBoundary';
 let iteration=0;
 for(const [platform,admission] of [['linux',true],['darwin',true],['win32',true],['freebsd',true],...['linux','darwin'].flatMap(platform=>[false,undefined,'true',1,{}].map(value=>[platform,value]))]){
  const process=new EventEmitter(),sent=[];let options,closed,replyError=false;
  const stopped=new Promise(resolve=>{closed=resolve;});
  Object.assign(process,{platform,connected:true,send(message){sent.push(message);if(message.type==='protect')process.emit('message',{type:'protected',id:message.id,...(replyError?{error:true}:{value:message.value})});},disconnect(){this.connected=false;closed();}});
  const boundary={process,pdfRenderBridge:()=>({close(){}}),installPdfRenderer:()=>()=>{},startWorkspaceDatabases:async()=>({async close(){}}),readPreference:async()=>null,
   DeviceStore:class{constructor(value){options=value;}},startServer:async()=>({url:'http://127.0.0.1:4173',async close(){}})};
  const modules={'./pdf-render-bridge.js':'pdfRenderBridge','./pdf-render-service.js':'installPdfRenderer','./workspace-databases.js':'startWorkspaceDatabases','./locations.js':'readPreference','./security/device-store.js':'DeviceStore','./server.js':'startServer'};
  const url=service.href+'?device='+iteration++,prior=globalThis[key];globalThis[key]=boundary;
  const hooks=registerHooks({
   resolve(specifier,context,next){return context.parentURL===url&&Object.hasOwn(modules,specifier)?{url:'device-service:'+iteration+'/'+modules[specifier],shortCircuit:true}:next(specifier,context);},
   load(specifier,context,next){
    if(specifier===url)return {format:'module',shortCircuit:true,source:'const process=globalThis.'+key+'.process;\n'+source};
    if(specifier.startsWith('device-service:'+iteration+'/')){const name=specifier.split('/').at(-1);return {format:'module',shortCircuit:true,source:'export const '+name+'=globalThis.'+key+'.'+name+';'};}
    return next(specifier,context);
   }
  });
  try{
   await import(url);const receive=process.listeners('message')[0];
   await receive({type:'start',preferencesFile:path.resolve('synthetic-desktop-preferences.json'),deviceProtection:admission});
   assert.equal(sent.at(-1).type,'ready');
   const admitted=['linux','darwin'].includes(platform)&&admission===true;
   assert.equal(Object.hasOwn(options,'protector'),admitted,platform+': '+JSON.stringify(admission));
   if(admitted){
    const bytes=Buffer.from([0,1,128,255]);assert.equal(options.protector.available(),true);
    assert.deepEqual(await options.protector.protect(bytes),bytes);assert.equal(sent.at(-1).operation,'encrypt');
    assert.deepEqual(await options.protector.unprotect(bytes),bytes);assert.equal(sent.at(-1).operation,'decrypt');
    replyError=true;await assert.rejects(options.protector.protect(bytes),{code:'DEVICE_UNAVAILABLE'});
   }
   await receive({type:'stop'});await stopped;
  }finally{hooks.deregister();if(prior===undefined)delete globalThis[key];else globalThis[key]=prior;}
 }
});
