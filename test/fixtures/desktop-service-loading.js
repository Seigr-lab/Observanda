import {registerHooks} from 'node:module';
const deferred={
 './workspace-databases.js':'export const startWorkspaceDatabases=()=>{throw Error("Database started after cancellation");};',
 './server.js':'process.send({type:"modules-loading"});await new Promise(resolve=>{globalThis.releaseServiceModules=resolve;});export const startServer=()=>{throw Error("HTTP started after cancellation");};',
 './locations.js':'export const readPreference=()=>null;',
 './security/device-store.js':'export class DeviceStore{};'
};
registerHooks({
 resolve(specifier,context,next){return context.parentURL?.endsWith('/src/desktop-service.js')&&Object.hasOwn(deferred,specifier)?{url:'startup-fixture:'+specifier,shortCircuit:true}:next(specifier,context);},
 load(url,context,next){return url.startsWith('startup-fixture:')?{format:'module',source:deferred[url.slice('startup-fixture:'.length)],shortCircuit:true}:next(url,context);}
});
process.on('message',message=>{if(message?.type==='release-modules')globalThis.releaseServiceModules?.();});
await import('../../src/desktop-service.js');
process.send({type:'fixture-ready'});
