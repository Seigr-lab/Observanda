import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {publicationExportHttp} from '../src/publication-export-http.js';
import {projectContentHttp} from '../src/project-content-http.js';
import {projectPublicationRequest} from '../src/project-publication-requests.js';

for(const owner of ['workspace','project'])test(owner+' ZIP download outlives socket inactivity and cancels preflight on disconnect',{timeout:10000},async t=>{
 let prepare,restored,completed,entered,cancelled;
 const files=new Map([['index.html','Visible document']]);
 const server=http.createServer(async(req,res)=>{
  const socket=req.socket;
  try{
   if(owner==='workspace')await publicationExportHttp(req,res,options=>prepare(options));
   else await projectContentHttp(req,res,projectPublicationRequest('/api/export/'+'a'.repeat(64)),{contextId:'current',execute:async(data,{binary,...options})=>binary({archive:await prepare(options)})});
   restored=socket.timeout;completed?.();
  }catch(error){if(error.name==='AbortError'){cancelled?.();res.destroy();}else if(!res.headersSent){res.writeHead(422,{'Content-Type':'application/json'});res.end(JSON.stringify({code:error.message}));}else res.destroy();}
 });
 server.setTimeout(40,socket=>socket.destroy());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const url='http://127.0.0.1:'+server.address().port;
 // Deliberately hold admission beyond this test's short idle timeout. This is
 // a lifecycle assertion, not a machine-dependent throughput expectation.
 prepare=async({signal})=>{await delay(120,undefined,{signal});return files;};
 const finished=new Promise(resolve=>completed=resolve),response=await fetch(url),bytes=Buffer.from(await response.arrayBuffer());
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(Buffer.from('Visible document')));await finished;assert.equal(restored,40);
 const reached=new Promise(resolve=>entered=resolve),aborted=new Promise(resolve=>cancelled=resolve);
 prepare=async({signal})=>{entered();await delay(10000,undefined,{signal});assert.fail('Aborted preparation must not return files');};
 const controller=new AbortController(),pending=fetch(url,{signal:controller.signal});await reached;controller.abort();await assert.rejects(pending,{name:'AbortError'});await aborted;
 prepare=async()=>{throw Error('ANALYSIS_REVIEW');};const denied=await fetch(url);assert.equal(denied.status,422);assert.deepEqual(await denied.json(),{code:'ANALYSIS_REVIEW'});assert.notEqual(denied.headers.get('content-type'),'application/zip');
});
