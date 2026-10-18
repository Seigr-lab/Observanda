import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {windowPreferences} from '../../desktop/policy.js';

test('desktop preview displays generated PDF pages with the application security policy',async({},info)=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-viewer-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app,server,pdf;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  pdf=Buffer.from(await app.evaluate(async()=>{const {renderPdfDocument}=await globalThis.pdfService;return (await renderPdfDocument({version:1,html:'<!doctype html><h1>Retained observations</h1><p>Exact integer 9007199254740993.</p>'})).bytes.toString('base64');}),'base64');
  server=createServer((request,response)=>{
   if(request.url==='/document.pdf'){response.writeHead(200,{'Content-Type':'application/pdf'});response.end(pdf);}
   else if(request.url==='/preview.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end("fetch('/document.pdf').then(reply=>reply.blob()).then(blob=>{document.querySelector('iframe').src=URL.createObjectURL(blob);});");}
   else{response.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self' blob:; object-src 'none'"});response.end('<!doctype html><html><body style="margin:0"><iframe title="PDF preview" style="width:100vw;height:100vh;border:0"></iframe><script src="/preview.js"></script></body></html>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  await app.evaluate(async({BrowserWindow},{url,preferences})=>{const win=new BrowserWindow({show:false,focusable:false,width:1000,height:900,webPreferences:{...preferences,backgroundThrottling:false}});await win.loadURL(url);},{url,preferences:windowPreferences});
  const page=await app.firstWindow();
  try{await expect.poll(()=>page.frames().some(frame=>frame.url().startsWith('chrome-extension:')),{timeout:15000}).toBe(true);}
  finally{await page.screenshot({path:info.outputPath('desktop-pdf-preview.png')});}
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(win=>win.isVisible()))).toBe(false);
 }finally{await app?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
