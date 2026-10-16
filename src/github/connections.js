import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite,assertRegular} from '../storage.js';
import {AppError} from '../errors.js';
import {GithubCredentialHelper,githubLogin} from './credential-helper.js';

// Account identities and bindings are local preferences. OAuth credentials
// belong to the OS credential store and never travel in workspace copies.
export class GithubConnections{
 constructor({file,helper,request=fetch}={}){
  this.file=file;this.request=request;this.helper=helper??new GithubCredentialHelper({directory:file+'.helper',namespace:'observanda-'+createHash('sha256').update(path.resolve(file)).digest('hex').slice(0,24)});this.pending=null;this.writes=Promise.resolve();this.cache=new Map();this.epoch=0;
 }
 key(root){return createHash('sha256').update(path.resolve(root)).digest('hex');}
 async read(){const stat=await assertRegular(this.file,{missing:true});if(!stat)return {version:1,bindings:{}};if(stat.size>262144)throw new AppError('GITHUB_CONNECTION_DAMAGED');try{const v=JSON.parse(await readFile(this.file,'utf8'));if(v.version!==1||Object.keys(v).sort().join()!=='bindings,version'||!v.bindings||Array.isArray(v.bindings)||typeof v.bindings!=='object'||Object.keys(v.bindings).length>512||Object.entries(v.bindings).some(([key,a])=>!/^[a-f0-9]{64}$/.test(key)||!a||Object.keys(a).sort().join()!=='id,login'||!Number.isSafeInteger(a.id)||a.id<=0||!githubLogin(a.login)))throw Error();return v;}catch{throw new AppError('GITHUB_CONNECTION_DAMAGED');}}
 async update(fn){const next=this.writes.then(async()=>{const data=await this.read();await fn(data);await atomicWrite(this.file,JSON.stringify(data));});this.writes=next.catch(()=>{});return next;}
 async identify(token,{signal}={}){
  let response;try{response=await this.request('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'User-Agent':'Observanda','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)])});}catch{throw new AppError(signal?.aborted?'GITHUB_SIGNIN_CANCELLED':'PUBLISH_REMOTE');}
  if(response.status===401)throw new AppError('GITHUB_RECONNECT');if(!response.ok)throw new AppError('PUBLISH_REMOTE');const user=await response.json();if(!Number.isSafeInteger(user.id)||user.id<=0||!githubLogin(user.login))throw new AppError('GITHUB_CREDENTIALS');return {id:user.id,login:user.login};
 }
 async summary(root){const selected=(await this.read()).bindings[this.key(root)]??null;return {selected,connected:!!selected&&!this.cache.get(selected.login)?.rejected};}
 async status(root){const selected=(await this.read()).bindings[this.key(root)]??null,available=await this.helper.available();let accounts=[],error=null;if(available)try{accounts=await this.helper.accounts();}catch(e){error=e instanceof AppError?e.code:'GITHUB_CREDENTIALS';}
  const pending=this.pending?.root===root?this.pending:null;return {available,accounts,selected,connected:!!selected&&accounts.some(login=>login.toLowerCase()===selected.login.toLowerCase())&&!this.cache.get(selected.login)?.rejected,error,signIn:pending?{id:pending.id,state:pending.state,error:pending.error??null}:null};
 }
 async start(root){
  if(this.changing||this.selecting||['waiting','saving'].includes(this.pending?.state))throw new AppError('GITHUB_SIGNIN_BUSY');
  const pending=this.pending={id:randomUUID(),root,state:'waiting',controller:new AbortController()},epoch=this.epoch;
  pending.promise=(async()=>{
   if(!await this.helper.available())throw new AppError('GITHUB_HELPER_MISSING');
   const credentials=await this.helper.credential(undefined,{interactive:true,signal:pending.controller.signal}),account=await this.identify(credentials.token,{signal:pending.controller.signal});
   if(pending.controller.signal.aborted||epoch!==this.epoch)throw new AppError('GITHUB_SIGNIN_CANCELLED');
   if(account.login.toLowerCase()!==credentials.login.toLowerCase())throw new AppError('GITHUB_CREDENTIALS');
   pending.state='saving';await this.helper.store(credentials);await this.update(data=>{data.bindings[this.key(root)]=account;});this.cache.set(account.login,{token:credentials.token,id:account.id});pending.state='completed';
  })().catch(error=>{pending.error=pending.controller.signal.aborted?'GITHUB_SIGNIN_CANCELLED':error instanceof AppError?error.code:'GITHUB_CREDENTIALS';pending.state=pending.error==='GITHUB_SIGNIN_CANCELLED'?'cancelled':'failed';});
  return {id:pending.id,state:pending.state};
 }
 async cancel(root){if(this.pending?.root===root){if(this.pending.state==='waiting'){this.epoch++;this.pending.controller.abort();}await this.pending.promise;}return this.status(root);}
 async choose(root,login){
  if(this.changing||this.selecting||['waiting','saving'].includes(this.pending?.state))throw new AppError('GITHUB_SIGNIN_BUSY');if(!githubLogin(login))throw new AppError('INVALID');
  const epoch=++this.epoch;this.selecting=true;
  this.selection=(async()=>{const credentials=await this.helper.credential(login),account=await this.identify(credentials.token);if(account.login.toLowerCase()!==login.toLowerCase())throw new AppError('GITHUB_CREDENTIALS');await this.update(data=>{if(epoch!==this.epoch)throw new AppError('GITHUB_SIGNIN_CANCELLED');data.bindings[this.key(root)]=account;});if(epoch===this.epoch)this.cache.set(account.login,{token:credentials.token,id:account.id});})();
  try{await this.selection;return await this.status(root);}finally{this.selecting=false;}
 }
 async token(root){const epoch=this.epoch;if(this.changing||this.selecting||this.pending?.root===root&&['waiting','saving'].includes(this.pending.state))throw new AppError('GITHUB_SIGNIN_BUSY');const account=(await this.read()).bindings[this.key(root)];if(epoch!==this.epoch||!account)throw new AppError('GITHUB_RECONNECT');const known=this.cache.get(account.login);if(known?.rejected)throw new AppError('GITHUB_RECONNECT');if(known?.id===account.id)return known.token;
  const credentials=await this.helper.credential(account.login),verified=await this.identify(credentials.token);if(epoch!==this.epoch||verified.id!==account.id)throw new AppError('GITHUB_RECONNECT');this.cache.set(account.login,{token:credentials.token,id:verified.id});return credentials.token;
 }
 async reject(root){const account=(await this.read()).bindings[this.key(root)];if(account)this.cache.set(account.login,{rejected:true});}
 async disconnect(root,{forget=false}={}){if(this.changing)throw new AppError('GITHUB_SIGNIN_BUSY');this.changing=true;try{await this.clear();const account=(await this.read()).bindings[this.key(root)];await this.update(data=>{delete data.bindings[this.key(root)];if(forget&&account)for(const [key,a] of Object.entries(data.bindings))if(a.id===account.id)delete data.bindings[key];});if(account&&forget)await this.helper.forget(account.login);return await this.status(root);}finally{this.changing=false;}}
 async clear(){this.epoch++;if(this.pending?.state==='waiting')this.pending.controller.abort();await Promise.allSettled([this.pending?.promise,this.selection]);this.cache.clear();}
 async forgetWorkspace(root){await this.clear();if(!await assertRegular(this.file,{missing:true}))return;await this.update(data=>{delete data.bindings[this.key(root)];});}
 async relocate(previous,root){
  if(this.changing||this.selecting||['waiting','saving'].includes(this.pending?.state))throw new AppError('GITHUB_SIGNIN_BUSY');
  const from=this.key(previous),to=this.key(root);if(from===to)return;
  await this.update(data=>{
   // Retry-safe if preferences could not be saved after this update. Preserve
   // an account explicitly chosen at the destination; never copy a credential.
   if(data.bindings[from]&&!data.bindings[to])data.bindings[to]=data.bindings[from];
   delete data.bindings[from];
  });
 }
 forWorkspace(root){return {summary:()=>this.summary(root),status:()=>this.status(root),start:()=>this.start(root),cancel:()=>this.cancel(root),choose:login=>this.choose(root,login),token:()=>this.token(root),reject:()=>this.reject(root),disconnect:options=>this.disconnect(root,options),clear:()=>this.clear()};}
}
