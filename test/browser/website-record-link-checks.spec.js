import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {testServer as startServer} from '../device-fixture.js';

// A record copy's link to another record is resolved when the website is
// published, so the editor's page checks do not report it as a broken link.
test('page checks accept record links of placed copies and still report broken page links',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-link-checks-'));await new Workspace(directory).create(sampleNotebook());
 const app=await startServer({root:directory,port:0,headless:true});
 try{
  await page.goto(app.url);
  const issues=await page.evaluate(async()=>{
   const {checkAuthoredPage}=await import('/website-author-checks.js');
   const doc=new DOMParser().parseFromString('<!doctype html><html lang="en"><head><title>Notes</title></head><body><main><h1>Notes</h1><p><a href="#observanda-record-11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222">Placed study</a> <a href="#missing-anchor">Missing</a></p></main></body></html>','text/html');
   return checkAuthoredPage(doc,'index.html',new URL('https://site.invalid/'),[{path:'index.html'}]).map(issue=>[issue.key,issue.detail]);
  });
  expect(issues).toEqual([['brokenLink','#missing-anchor']]);
 }finally{await app.close();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
