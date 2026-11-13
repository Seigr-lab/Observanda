// Authenticated catalogue connections are kept briefly between operations, so
// a request reuses a connection instead of starting a new server process for
// every catalogue open. A connection is parked only after its transaction was
// rolled back and DISCARD ALL reset its session (settings, temporary tables,
// cursors, prepared statements, advisory locks and listeners). It is reused
// only under the exact same login, server, database and owner: never across
// roles or owners. Parked connections hold no admission slot and no runtime
// reference; closing an owner or a workspace cluster closes them first.
import {createHash} from 'node:crypto';
import {nativeResources} from './native-resource-budget.js';
import {AppError} from './errors.js';

const OWNER_FIELDS=['OBSERVANDA_WORKSPACE_DATABASE_ROOT','OBSERVANDA_PROJECT_DATABASE_ROOT','OBSERVANDA_PROJECT_ID','OBSERVANDA_LAB_BOOK_DATABASE_ROOT','OBSERVANDA_LAB_BOOK_ID'];
const loopback=host=>['localhost','127.0.0.1','::1'].includes(host)?'loopback':host.toLowerCase();
export function idleConnectionScope(configuration){return {host:loopback(configuration.host),port:configuration.port,user:configuration.user};}
// The key names everything a session depends on. The password is hashed so a
// key never holds the credential itself.
export function idleConnectionKey(configuration,env,storage){
 const scope=idleConnectionScope(configuration),hash=createHash('sha256');
 for(const value of [scope.host,String(scope.port),configuration.database,scope.user,configuration.password,configuration.ssl?'tls:'+JSON.stringify({ca:configuration.ssl.ca??null}):'plain',storage??'',...OWNER_FIELDS.map(field=>env?.[field]??'')])hash.update(String(value)).update('\0');
 return hash.digest('hex');
}
export class IdleConnections{
 constructor({perKey=3,limit=8,idleMs=30000}={}){
  if(![perKey,limit].every(value=>Number.isSafeInteger(value)&&value>=0)||!Number.isSafeInteger(idleMs)||idleMs<0)throw new AppError('INVALID');
  Object.assign(this,{perKey,limit,idleMs});this.entries=[];
 }
 get size(){return this.entries.length;}
 // Most recently parked first: the warmest connection serves the next open.
 take(key,usable=()=>true){
  for(let index=this.entries.length-1;index>=0;index--){
   const entry=this.entries[index];if(entry.key!==key)continue;
   this.remove(entry);
   if(usable(entry.client)){entry.client.connection?.stream?.ref?.();return entry.client;}
   void entry.close();
  }
  return null;
 }
 park(key,client,scope,close){
  if(!this.limit||!this.perKey||this.entries.filter(entry=>entry.key===key).length>=this.perKey)return false;
  if(this.entries.length>=this.limit)this.evictOldest();
  const entry={key,client,scope,closed:null};
  const lost=()=>{if(this.entries.includes(entry)){this.remove(entry);void entry.close();}};
  entry.close=()=>entry.closed??=Promise.resolve().then(close).catch(()=>{});
  entry.lost=lost;client.once('error',lost);client.once('end',lost);
  entry.timer=setTimeout(lost,this.idleMs);entry.timer.unref?.();
  // A parked socket must not keep the process alive.
  client.connection?.stream?.unref?.();
  this.entries.push(entry);return true;
 }
 remove(entry){
  const index=this.entries.indexOf(entry);if(index<0)return;
  // Every pooled client keeps its permanent no-op error listener from connect().
  this.entries.splice(index,1);clearTimeout(entry.timer);entry.client.off('error',entry.lost);entry.client.off('end',entry.lost);
 }
 evictOldest(){const [entry]=this.entries;if(!entry)return false;this.remove(entry);void entry.close();return true;}
 // Closing an owner closes its role's connections; closing a cluster closes
 // every role's connections to it. Removal is synchronous, so no later open
 // can take a connection that is being closed.
 close(predicate=()=>true){
  const selected=this.entries.filter(entry=>predicate(entry.scope));
  for(const entry of selected)this.remove(entry);
  return Promise.all(selected.map(entry=>entry.close())).then(()=>{});
 }
}
export const idleConnections=new IdleConnections();
nativeResources.onPressure(()=>{void idleConnections.close();});
// Closes the parked connections of the login in env (an owner), or of every
// login on env's server when cluster is true (a stopping workspace cluster).
export function closeIdleConnections(env,{cluster=false}={}){
 let url;try{url=new URL(env?.OBSERVANDA_DATABASE_URL);}catch{return Promise.resolve();}
 const host=loopback(url.hostname.replace(/^\[|\]$/g,'')),port=Number(url.port||5432),user=decodeURIComponent(url.username);
 return idleConnections.close(scope=>scope.host===host&&scope.port===port&&(cluster||scope.user===user));
}
