import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FTPError} from 'basic-ftp';
import {FTPTransport} from '../src/ftp-transfer.js';

// A stand-in for the FTP client: a server whose rename never overwrites, as
// many FTP servers behave, so replacing a file must remove the target first.
function client(){
 const files=new Map(),calls=[];let cwd='/';
 const missing=()=>new FTPError({code:550,message:'550 Not found'});
 const value={calls,files,
  async access(options){calls.push(['access',options]);},
  async size(file){if(!files.has(file))throw missing();return files.get(file).length;},
  async downloadTo(sink,file){if(!files.has(file))throw missing();await new Promise((resolve,reject)=>sink.write(files.get(file),error=>error?reject(error):resolve()));},
  async uploadFrom(stream,file){const chunks=[];for await(const chunk of stream)chunks.push(chunk);files.set(file,Buffer.concat(chunks));calls.push(['upload',file]);},
  async list(){return [];},
  async ensureDir(directory){calls.push(['ensureDir',directory]);cwd=directory;},
  async cd(directory){cwd=directory;calls.push(['cd',directory]);},
  async rename(from,to){if(!files.has(from))throw missing();if(files.has(to))throw new FTPError({code:553,message:'553 exists'});files.set(to,files.get(from));files.delete(from);calls.push(['rename',from,to]);},
  async remove(file,ignore){if(!files.has(file)){if(ignore)return;throw missing();}files.delete(file);calls.push(['remove',file]);},
  async removeDir(directory){calls.push(['removeDir',directory]);},
  close(){calls.push(['close']);},
  get cwd(){return cwd;}};
 return value;
}
const host={host:'example.org',port:21,user:'site',directory:'/public_html'};

test('FTPS is used by default with the certificate checked for the host name, plain FTP only when chosen',async()=>{
 for(const [security,secure] of [['explicit',true],['implicit','implicit'],['none',false]]){
  const c=client(),session=await new FTPTransport({createClient:()=>c}).open({...host,security},{password:'secret'});
  const [,options]=c.calls[0];assert.equal(options.secure,secure);assert.equal(options.secureOptions.servername,'example.org');assert.equal(options.secureOptions.minVersion,'TLSv1.2');assert.equal(options.password,'secret');
  await session.close();assert.deepEqual(c.calls.at(-1),['close']);
 }
 await assert.rejects(new FTPTransport({createClient:client}).open({...host,security:'tls'},{password:'x'}),{code:'PUBLISH_CONFIG'});
 await assert.rejects(new FTPTransport({createClient:client}).open({...host,security:'explicit'}),{code:'PUBLISH_PASSWORD'});
 const failing=client();failing.access=async()=>{throw new Error('530 Login incorrect');};
 await assert.rejects(new FTPTransport({createClient:()=>failing}).open({...host,security:'explicit'},{password:'wrong'}),{code:'PUBLISH_FTP'});
});

test('files are replaced in place on servers that refuse to rename over an existing file, and a repeated move is harmless',async()=>{
 const c=client(),session=await new FTPTransport({createClient:()=>c}).open({...host,security:'explicit'},{password:'secret'});
 assert.equal(await session.readText('/public_html/.observanda-owner',{missing:true}),null);
 await session.writeText('/public_html/.observanda-owner','owner');assert.equal(await session.readText('/public_html/.observanda-owner'),'owner');
 await session.ensureDirectories(['/public_html/a/b']);assert.deepEqual(c.calls.filter(call=>call[0]==='ensureDir'||call[0]==='cd').slice(-2),[['ensureDir','/public_html/a/b'],['cd','/']]);
 c.files.set('/public_html/index.html',Buffer.from('old'));
 await session.upload([{content:'new',target:'/public_html/.up/index.html'}]);
 await session.replace([{from:'/public_html/.up/index.html',to:'/public_html/index.html'}]);
 assert.equal(c.files.get('/public_html/index.html').toString(),'new');assert.equal(c.files.has('/public_html/.up/index.html'),false);
 await session.replace([{from:'/public_html/.up/index.html',to:'/public_html/index.html'}]);
 assert.equal(c.files.get('/public_html/index.html').toString(),'new');
 await session.remove(['/public_html/index.html','/public_html/never-existed.html']);assert.equal(c.files.has('/public_html/index.html'),false);
 c.files.set('/public_html/.observanda-owner',Buffer.alloc(5000,'x'));await assert.rejects(session.readText('/public_html/.observanda-owner'),{code:'PUBLISH_OWNERSHIP'});
 await session.close();
});
