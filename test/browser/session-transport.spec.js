import {test,expect} from '@playwright/test';
import http from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';

test('session transport preserves streaming cancellation and never follows a credential-bearing redirect',async({page})=>{
 const credential='a'.repeat(64),requests=[],closed=[];let origin;
 const server=http.createServer(async(request,response)=>{
  const url=new URL(request.url,origin);requests.push({path:url.pathname,credential:request.headers['x-observanda-session']});
  if(url.pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Session transport</title>');return;}
  if(['/session-worker.js','/session-store.js','/browser-session.js','/session-preview.js','/session-download.js'].includes(url.pathname)){response.setHeader('Content-Type','text/javascript');response.end(await readFile(new URL('../../src/web'+url.pathname,import.meta.url)));return;}
  if(url.pathname==='/locales/en/startup.json'){response.setHeader('Content-Type','application/json');response.end(await readFile(new URL('../../src/web/locales/en/startup.json',import.meta.url)));return;}
  if(url.pathname==='/api/stream'){response.writeHead(200,{'Content-Type':'text/plain'});response.write('begin');response.on('close',()=>closed.push('stream'));return;}
  if(url.pathname==='/api/redirect'){response.writeHead(302,{Location:origin+'/capture'});response.end();return;}
  response.end('capture');
 });server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
 try{
  await page.goto(origin);await page.evaluate(async credential=>{const {authorizeBrowser}=await import('/browser-session.js');await authorizeBrowser(credential);},credential);
  await page.evaluate(()=>{globalThis.stopStream=new AbortController();globalThis.streamResult=fetch('/api/stream',{signal:stopStream.signal}).then(response=>response.text()).catch(error=>error.name);});
  await expect.poll(()=>requests.some(request=>request.path==='/api/stream'&&request.credential===credential)).toBe(true);
  expect(await page.evaluate(async()=>{stopStream.abort();return streamResult;})).toBe('AbortError');await expect.poll(()=>closed,{timeout:5000}).toEqual(['stream']);
  expect(await page.evaluate(async()=>{try{await fetch('/api/redirect');return 'followed';}catch{return 'rejected';}})).toBe('rejected');expect(requests.some(request=>request.path==='/capture')).toBe(false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
