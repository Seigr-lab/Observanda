import {setTimeout as delay} from 'node:timers/promises';
import {withNativeDestination} from './native-destination.js';
import {AppError} from './errors.js';

const folder='.observanda/website-files/upgrades',running=new Map();
export const upgradeControl=name=>folder+'/'+name+'.json';
const upgradeLease=name=>folder+'/'+name+'.lock';
// Website writers lease an empty file named writer in the folder they guard;
// upgrades lease one file each. Neither holds website content.
export const WEBSITE_WRITER_LEASE='writer';
export const websiteLeaseFile=relative=>relative.startsWith('.observanda/website-files/')&&(relative.slice(relative.lastIndexOf('/')+1)===WEBSITE_WRITER_LEASE||relative.startsWith(folder+'/')&&relative.endsWith('.lock')&&!relative.slice(folder.length+1).includes('/'));
// Upgrade and discovery controls record each folder's own conversion state;
// an opened destination rewrites them. They hold no website content.
export const websiteUpgradeControlFile=relative=>relative.startsWith(folder+'/')&&relative.endsWith('.json')&&!relative.slice(folder.length+1).includes('/');

// The OS releases this dedicated lease on process exit. Other website files
// keep their own shorter write transactions during conversion.
export async function runWebsiteUpgrade(store,name,operation,{signal,shareResult=true}={}){
 signal?.throwIfAborted();
 await store.scope(()=>{}, {signal}); // authenticate each caller independently
 const key=JSON.stringify([store.workspace.root,store.workspace.vault.id,name]);
 const active=shareResult&&running.get(key);
 if(active)return active;
 const work=(async()=>{
  await store.scope(scope=>scope.ensure(folder),{write:true,signal});
  return withNativeDestination(store.workspace.root,async scope=>{
   await scope.admit();let lease;const member=store.absolute(upgradeLease(name));
   while(!lease){
    signal?.throwIfAborted();try{lease=await scope.member(member,(dir,file)=>dir.lease(file));}
    catch(error){if(error.code!=='EBUSY')throw error;await delay(200,undefined,{signal});}
   }
   try{return await operation();}finally{await lease.close();}
  });
 })();
 if(shareResult)running.set(key,work);
 try{return await work;}finally{if(running.get(key)===work)running.delete(key);}
}
export function validateUpgradeState(value){
 if(value===null)return {state:'unprepared',total:0,done:0};
 if(value.version!==1||!['preparing','ready','failed'].includes(value.state)||!Number.isSafeInteger(value.total)||!Number.isSafeInteger(value.done)||value.total<value.done||value.done<0)throw new AppError('FORMAT');
 const {version,...status}=value;return status;
}
