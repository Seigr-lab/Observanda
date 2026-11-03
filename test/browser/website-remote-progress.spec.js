import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {defaultPublishing} from '../../src/publishing.js';
import {safeError} from '../../src/errors.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {githubFixture} from '../github-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('remote review and publish stream measured progress and resume acknowledged work without reporting it twice',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'website-progress-'));await mkdir(path.join(directory,'.observanda'));
 const workspace=new Workspace(directory,{id:randomUUID(),key:randomBytes(32)}),remote=githubFixture({branch:'main',initialFiles:{'README.md':'Keep'}});
 workspace.catalogue=workspace.openCatalogue=()=>{throw Error('Research opened');};
 const requests=[],gates=[];let origin;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,origin),json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const body=async()=>{const chunks=[];for await(const part of req)chunks.push(part);return JSON.parse(Buffer.concat(chunks).toString()||'{}');};
  requests.push([url.pathname,req.headers.accept]);
  try{if(!await websiteFilesHttp(req,res,{workspace,url,body,json,check:async()=>{},title:'Field atlas',preparation:async()=>({state:'ready'}),publisherOptions:{request:remote.request,liveRequest:remote.request,connection:{summary:()=>({connected:true}),token:()=>'fixture-token'}}})){res.statusCode=404;res.end();}}
  catch(error){res.statusCode=422;json(safeError(error));}
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const post=async(op,data)=>{const r=await fetch(origin+'/api/website-files/'+op,{method:'POST',body:JSON.stringify(data)});expect(r.headers.get('content-type')).toBe('application/json');return r.json();};
  const {site}=await post('create',{name:'Field atlas'}),config=defaultPublishing();config.publicUrl='https://public.example/research/';Object.assign(config.github,{owner:'example',repository:'notebook',directory:'atlas',pages:false});
  await post('destination/save',{siteId:site.id,config,etag:'new'});
  const gate=()=>{const value=Promise.withResolvers();gates.push(value);return value;};
  const reviewPause=gate();remote.setHook(async(row,phase)=>{if(phase==='before'&&row.route.includes('/git/trees/'))await reviewPause.promise;});
  await mountFilesEditor(page,{httpOrigin:origin});await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const progress=page.locator('.website-files-publish .operation-progress');await expect(progress.getByRole('heading')).toHaveText('Reading destination files');
  reviewPause.resolve();const review=page.locator('[data-website-files-review]');await expect(review.getByRole('checkbox')).toBeVisible();await expect(progress).toHaveCount(0);
  const uploadPause=gate();let firstBytes=0,posted=0,lost=false;
  remote.setHook(async(row,phase)=>{
   if(phase==='before'&&row.route.endsWith('/git/blobs')){if(++posted===1)firstBytes=Buffer.from(row.data.content,'base64').length;if(posted===2)await uploadPause.promise;}
   if(phase==='after'&&!lost&&row.method==='PATCH'&&row.route.includes('/git/refs/heads/')){lost=true;throw Error('Lost acknowledgement');}
  });
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
  await expect(progress.locator('[data-count]')).toHaveText('Destination confirmed 1 of 3 upload items.');
  await expect(progress.locator('[data-detail]')).toHaveText('Payload confirmed during this attempt: '+firstBytes.toLocaleString('en')+' bytes');
  uploadPause.resolve();const transfer=page.locator('[data-website-files-transfer]');await expect(transfer).toContainText('has not confirmed the final result');
  const retryPause=gate();remote.setHook(async(row,phase)=>{if(phase==='before'&&row.route.endsWith('/git/ref/heads/main'))await retryPause.promise;});
  await transfer.getByRole('button',{name:'Resume reviewed transfer'}).click();
  await expect(progress.locator('[data-count]')).toHaveText('Destination confirmed 3 of 3 upload items.');await expect(progress.locator('[data-detail]')).toHaveText('Payload confirmed during this attempt: 0 bytes');
  retryPause.resolve();await expect(transfer).toContainText('Repository files uploaded and verified');await expect(progress).toHaveCount(0);
  expect(remote.calls.filter(row=>row.route.endsWith('/git/blobs'))).toHaveLength(3);expect(remote.calls.filter(row=>row.method==='PATCH'&&row.route.includes('/git/refs/heads/'))).toHaveLength(1);
  const manifest=[...remote.blobs.values()].find(bytes=>bytes.toString().includes('"generator": "Observanda"'));remote.setManifest(manifest.toString());
  const verifyPause=gate();remote.setHook(async(row,phase)=>{if(phase==='before'&&row.route.startsWith('/research/')&&!row.route.endsWith('/publication.json'))await verifyPause.promise;});
  await transfer.getByRole('button',{name:'Verify live website'}).click();await expect(progress.getByRole('heading')).toHaveText('Checking files on the live website');
  await expect(progress.locator('[data-count]')).toHaveText('1 of 3 files completed in this stage');await expect(progress.locator('[data-detail]')).toHaveText('Website content checked: '+manifest.length.toLocaleString('en')+' bytes');
  verifyPause.resolve();await expect(transfer).toContainText('live website is verified');
  expect(requests.filter(([name])=>['plan','publish','verify'].includes(name.split('/').at(-1))).map(([,accept])=>accept)).toEqual(Array(4).fill('application/x-ndjson'));
 }finally{for(const g of gates)g.resolve();await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
