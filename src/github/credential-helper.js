import {spawn} from 'node:child_process';
import {access,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from '../errors.js';

export const githubLogin=value=>typeof value==='string'&&/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value);
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
export async function githubRuntime(){
 const bundled=fileURLToPath(new URL('../../dist/desktop-resources/github/',import.meta.url));
 const helper=process.platform==='win32'?'git-credential-manager.exe':'git-credential-manager',git=process.platform==='win32'?'git.exe':'git';
 const explicit=[process.env.OBSERVANDA_GITHUB_HELPER,process.env.OBSERVANDA_GITHUB_GIT];
 const pairs=explicit.some(Boolean)?[explicit]:[
  [path.join(bundled,'credential-manager',helper),path.join(bundled,'git',process.platform==='win32'?'cmd':'bin',git)],
  ...(process.platform==='win32'?['ucrt64','mingw64'].map(arch=>[path.join(process.env.ProgramFiles??'C:\\Program Files','Git',arch,'bin',helper),path.join(process.env.ProgramFiles??'C:\\Program Files','Git','cmd',git)]):[['/usr/local/bin/'+helper,'/usr/local/bin/git'],['/opt/homebrew/bin/'+helper,'/opt/homebrew/bin/git']])
 ];
 for(const [executable,gitPath] of pairs)if(executable&&gitPath&&path.isAbsolute(executable)&&path.isAbsolute(gitPath)&&await exists(executable)&&await exists(gitPath))return {executable,gitPath};
 throw new AppError('GITHUB_HELPER_MISSING');
}

export class GithubCredentialHelper{
 constructor({directory,namespace,runtime=githubRuntime,spawnProcess=spawn,platform=process.platform}={}){this.directory=directory;this.namespace=namespace;this.runtime=runtime;this.spawnProcess=spawnProcess;this.platform=platform;}
 async available(){try{await this.runtime();return ['win32','darwin','linux'].includes(this.platform);}catch{return false;}}
 async run(args,{input='',signal,interactive=false,store=true,accountListing=false}={}){
  const {executable,gitPath}=await this.runtime();await mkdir(this.directory,{recursive:true,mode:0o700});
  const env={...process.env};for(const key of Object.keys(env))if(/^(GIT_|GCM_)/i.test(key))delete env[key];
  Object.assign(env,{GIT_EXEC_PATH:path.dirname(gitPath),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:this.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_SYSTEM:this.platform==='win32'?'NUL':'/dev/null',GIT_CEILING_DIRECTORIES:path.dirname(this.directory),GIT_TERMINAL_PROMPT:'0',GCM_NAMESPACE:this.namespace,GCM_CREDENTIAL_STORE:store?({win32:'wincredman',darwin:'keychain',linux:'secretservice'}[this.platform]):'none',GCM_PROVIDER:'github',GCM_GITHUB_AUTHMODES:'browser',GCM_INTERACTIVE:interactive?'1':'0',GCM_GUI_PROMPT:'0',GCM_TRACE:'0',GCM_TRACE_SECRETS:'0',GCM_TRACE_MSAUTH:'0',GCM_ALLOW_UNSAFE_REMOTES:'false'});
  if(!env.GCM_CREDENTIAL_STORE)throw new AppError('GITHUB_HELPER_MISSING');
  const stop=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(interactive?180000:30000)]);
  return new Promise((resolve,reject)=>{
   const child=this.spawnProcess(executable,args,{cwd:this.directory,env,signal:stop,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',failed=false;
   let outputBytes=0;const collect=bytes=>{if(failed)return;outputBytes+=bytes.length;if(outputBytes>65536){failed=true;child.kill();return;}output+=bytes.toString('utf8');};
   child.stdout.on('data',collect);
   // GCM 3 writes the account list to its console (stderr); credential protocol
   // replies remain stdout-only. Never expose either stream in diagnostics.
   if(accountListing)child.stderr.on('data',collect);else child.stderr.resume();child.stdin.on('error',()=>{});
   child.on('error',()=>{failed=true;});child.once('close',code=>{if(stop.aborted)return reject(new AppError(signal?.aborted?'GITHUB_SIGNIN_CANCELLED':'GITHUB_SIGNIN_TIMEOUT'));if(failed||code!==0)return reject(new AppError('GITHUB_CREDENTIALS'));resolve(output);});child.stdin.end(input);
  });
 }
 async accounts(){const output=await this.run(['github','list','--url','https://github.com','--no-ui'],{accountListing:true});return [...new Set(output.split(/\r?\n/).map(v=>v.trim()).filter(githubLogin))].sort((a,b)=>a.localeCompare(b,'en'));}
 async credential(login,{signal,interactive=false}={}){
  if(login!==undefined&&!githubLogin(login))throw new AppError('INVALID');
  const output=await this.run(['get'],{input:'protocol=https\nhost=github.com\n'+(login?'username='+login+'\n':'')+'\n',signal,interactive,store:!interactive});
  const values={};for(const line of output.split(/\r?\n/)){const i=line.indexOf('=');if(i>0){const key=line.slice(0,i);if(Object.hasOwn(values,key))throw new AppError('GITHUB_CREDENTIALS');values[key]=line.slice(i+1);}}
  if(!githubLogin(values.username)||!/^[A-Za-z0-9_]{20,255}$/.test(values.password??'')||values.host&&values.host!=='github.com'||values.protocol&&values.protocol!=='https'||login&&values.username.toLowerCase()!==login.toLowerCase())throw new AppError('GITHUB_CREDENTIALS');
  return {login:values.username,token:values.password};
 }
 async store({login,token}){if(!githubLogin(login)||!/^[A-Za-z0-9_]{20,255}$/.test(token))throw new AppError('GITHUB_CREDENTIALS');await this.run(['store'],{input:'protocol=https\nhost=github.com\nusername='+login+'\npassword='+token+'\n\n'});}
 async forget(login){if(!githubLogin(login))throw new AppError('INVALID');await this.run(['erase'],{input:'protocol=https\nhost=github.com\nusername='+login+'\n\n'});}
}
