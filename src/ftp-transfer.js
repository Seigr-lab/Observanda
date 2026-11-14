// FTP and FTPS access to a web host for remote-site-publishing.js. FTPS
// (explicit or implicit TLS, certificate checked) is the default; plain FTP
// sends the password unencrypted and is used only when the author chose it.
import {Writable} from 'node:stream';
import {Client,FTPError} from 'basic-ftp';
import {AppError} from './errors.js';
import {contentStream} from './file-content.js';

import {FTP_SECURITY} from './server-logins.js';
export {FTP_SECURITY};
const missing=error=>error instanceof FTPError&&error.code>=550&&error.code<=553;
const failed=error=>{if(error instanceof AppError||error?.name==='AbortError')return error;return new AppError('PUBLISH_FTP');};

export class FTPTransport{
 constructor({createClient=()=>new Client(30000)}={}){this.createClient=createClient;}
 async open(c,{signal,password}={}){
  if(!FTP_SECURITY.includes(c.security))throw new AppError('PUBLISH_CONFIG');
  if(typeof password!=='string')throw new AppError('PUBLISH_PASSWORD');
  const client=this.createClient(),abort=()=>client.close();signal?.addEventListener('abort',abort,{once:true});
  try{
   await client.access({host:c.host,port:c.port,user:c.user,password,secure:c.security==='none'?false:c.security==='implicit'?'implicit':true,secureOptions:{servername:c.host,minVersion:'TLSv1.2'}});
  }catch(error){signal?.removeEventListener('abort',abort);client.close();signal?.throwIfAborted();throw failed(error);}
  return new FTPSession(client,()=>signal?.removeEventListener('abort',abort),signal);
 }
}

class FTPSession{
 constructor(client,detach,signal){this.client=client;this.detach=detach;this.signal=signal;}
 async run(operation){try{return await operation(this.client);}catch(error){this.signal?.throwIfAborted();throw failed(error);}}
 async exists(file){try{await this.client.size(file);return true;}catch(error){if(missing(error))return false;throw error;}}
 readText(file,{missing:allowMissing=false}={}){return this.run(async client=>{
  // Only a short marker is ever read. A longer file is drained, never kept,
  // and refused once the transfer has ended (a stream error would go unheard).
  const chunks=[];let size=0;
  const sink=new Writable({write(chunk,_encoding,done){size+=chunk.length;if(size<=4096)chunks.push(chunk);done();}});
  try{await client.downloadTo(sink,file);}catch(error){if(allowMissing&&missing(error))return null;throw error;}
  if(size>4096)throw new AppError('PUBLISH_OWNERSHIP');
  return Buffer.concat(chunks).toString('utf8');
 });}
 writeText(file,text){return this.run(client=>client.uploadFrom(contentStream(text),file));}
 list(directory){return this.run(async client=>(await client.list(directory)).filter(entry=>!['.','..'].includes(entry.name)).map(entry=>({name:entry.name,directory:entry.isDirectory,size:entry.size})));}
 ensureDirectory(directory){return this.ensureDirectories([directory]);}
 // ensureDir changes the working folder; every other call uses absolute paths.
 ensureDirectories(directories){return this.run(async client=>{for(const directory of directories){this.signal?.throwIfAborted();await client.ensureDir(directory);}await client.cd('/');});}
 upload(items){return this.run(async client=>{for(const {content,target} of items){this.signal?.throwIfAborted();await client.uploadFrom(contentStream(content),target);}});}
 // Repeating a finished move finds its source gone and leaves the target.
 replace(moves){return this.run(async client=>{
  for(const {from,to} of moves){
   this.signal?.throwIfAborted();
   if(!await this.exists(from))continue;
   try{await client.rename(from,to);}
   catch(error){if(!missing(error)||!await this.exists(to))throw error;await client.remove(to);await client.rename(from,to);}
  }
 });}
 remove(files){return this.run(async client=>{for(const file of files){this.signal?.throwIfAborted();await client.remove(file,true);}});}
 removeTree(directory){return this.run(async client=>{try{await client.removeDir(directory);}catch(error){if(!missing(error))throw error;}await client.cd('/');});}
 async close(){this.detach();this.client.close();}
}
