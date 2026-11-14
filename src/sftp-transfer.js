// SFTP access to a web host for remote-site-publishing.js. It uses only the
// SFTP protocol through the system's OpenSSH client in batch mode, so hosts
// that offer SFTP without a shell are served. Sign-in uses the author's SSH key
// and an already known host key; nothing is ever trusted on first contact.
// Local copies for upload stay in the workspace's own staging folder.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from './errors.js';
import {writePublicFile} from './file-content.js';
import {SSHHost} from './ssh-host.js';

const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
// sftp expands wildcards in remote names; such names are refused, not guessed.
export const sftpPath=value=>typeof value==='string'&&value.startsWith('/')&&!/[*?[\]\\\x00-\x1f]/.test(value);
const listing=/^([dl-])[rwxsStT-]{9}\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/;
const parents=directory=>{const parts=directory.split('/').filter(Boolean),result=[];for(let i=1;i<=parts.length;i++)result.push('/'+parts.slice(0,i).join('/'));return result;};

export function runSftp(args,{input,signal}){
 return new Promise((resolve,reject)=>{
  const child=spawn('sftp',args,{signal,timeout:600000,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',size=0,failed=false;
  child.stdout.on('data',bytes=>{size+=bytes.length;if(size>16*1024*1024){failed=true;child.kill();return;}output+=bytes.toString('utf8');});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{failed=true;});
  child.on('close',code=>{if(signal?.aborted)return reject(signal.reason);if(failed||code!==0)return reject(new AppError('PUBLISH_SFTP'));resolve(output);});
  child.stdin.end(input);
 });
}
const valid=c=>/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(c.host)&&/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(c.user)&&Number.isInteger(c.port)&&c.port>=1&&c.port<=65535&&sftpPath(c.directory)&&(!c.identityFile||path.isAbsolute(c.identityFile));

export class SFTPTransport{
 constructor({run=runSftp,staging}={}){if(!staging)throw new AppError('INVALID');this.run=run;this.staging=staging;}
 async open(c,{signal}={}){
  if(!valid(c))throw new AppError('PUBLISH_CONFIG');
  await mkdir(this.staging,{recursive:true,mode:0o700});
  const local=await mkdtemp(path.join(this.staging,'sftp-'));
  const session=new SFTPSession(this.run,c,local,signal);
  try{await session.batch([]);}catch(error){await session.close();throw error;}
  return session;
 }
}

class SFTPSession{
 constructor(run,c,local,signal){this.runner=run;this.c=c;this.local=local;this.signal=signal;this.counter=0;}
 batch(commands){
  this.signal?.throwIfAborted();
  for(const command of commands)if(/[\r\n]/.test(command))throw new AppError('PUBLISH_CONFIG');
  return this.runner([...new SSHHost().args(this.c),'-P',String(this.c.port),'-b','-',`${this.c.user}@${this.c.host}`],{input:[...commands,'quit'].join('\n')+'\n',signal:this.signal});
 }
 checked(...files){for(const file of files)if(!sftpPath(file))throw new AppError('PUBLISH_PATH');}
 async readText(file,{missing=false}={}){
  this.checked(file);const target=path.join(this.local,'read-'+(++this.counter));
  await this.batch([(missing?'-':'')+'get '+quote(file)+' '+quote(target)]);
  try{const text=await readFile(target,'utf8');if(text.length>4096)throw new AppError('PUBLISH_OWNERSHIP');return text;}
  catch(error){if(error.code==='ENOENT'&&missing)return null;if(error instanceof AppError)throw error;throw new AppError('PUBLISH_SFTP');}
  finally{await rm(target,{force:true});}
 }
 async writeText(file,text){await this.upload([{content:text,target:file}]);}
 async list(directory){
  this.checked(directory);
  const output=await this.batch(['ls -lan '+quote(directory)]),entries=[];
  for(const line of output.split(/\r?\n/)){
   if(line.startsWith('sftp>'))continue;const match=listing.exec(line);if(!match)continue;
   const name=path.posix.basename(match[3]);if(['.','..'].includes(name))continue;
   entries.push({name,directory:match[1]==='d',size:Number(match[2])});
  }
  return entries;
 }
 ensureDirectory(directory){return this.ensureDirectories([directory]);}
 // Existing folders refuse mkdir; those refusals are expected and ignored,
 // and entering each folder afterwards proves that it is now there.
 async ensureDirectories(directories){
  this.checked(...directories);
  const all=[...new Set(directories.flatMap(parents))].sort((a,b)=>a.split('/').length-b.split('/').length);
  await this.batch(all.map(directory=>'-mkdir '+quote(directory)));
  await this.batch(directories.map(directory=>'cd '+quote(directory)));
 }
 async upload(items){
  this.checked(...items.map(item=>item.target));
  const files=[];
  try{
   for(const {content,target} of items){const file=path.join(this.local,'put-'+(++this.counter));await writePublicFile(file,content,{mode:0o600});files.push([file,target]);}
   await this.batch(files.map(([file,target])=>'put '+quote(file)+' '+quote(target)));
  }finally{for(const [file] of files)await rm(file,{force:true});}
 }
 // A rename onto an existing name succeeds where the server supports POSIX
 // rename. Otherwise the remaining sources are retried after removing their
 // targets. A source already moved by an earlier attempt is skipped.
 async replace(moves){
  this.checked(...moves.flatMap(move=>[move.from,move.to]));
  await this.batch(moves.map(move=>'-rename '+quote(move.from)+' '+quote(move.to)));
  const left=[];
  for(const directory of new Set(moves.map(move=>path.posix.dirname(move.from)))){
   const present=new Set((await this.list(directory).catch(()=>[])).map(entry=>entry.name));
   for(const move of moves)if(path.posix.dirname(move.from)===directory&&present.has(path.posix.basename(move.from)))left.push(move);
  }
  if(left.length)await this.batch(left.flatMap(move=>['-rm '+quote(move.to),'rename '+quote(move.from)+' '+quote(move.to)]));
 }
 async remove(files){this.checked(...files);if(files.length)await this.batch(files.map(file=>'-rm '+quote(file)));}
 async removeTree(directory){
  this.checked(directory);
  const entries=await this.list(directory).catch(()=>null);if(entries===null)return;
  const files=[];
  for(const entry of entries){const child=directory+'/'+entry.name;if(entry.directory)await this.removeTree(child);else files.push(child);}
  await this.batch([...files.map(file=>'-rm '+quote(file)),'-rmdir '+quote(directory)]);
 }
 async close(){await rm(this.local,{recursive:true,force:true});}
}
