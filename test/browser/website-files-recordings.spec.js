import {test,expect} from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {serveContent} from '../../src/file-content.js';
import {mediaCapabilities} from '../../src/media.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {readRecordingUpload,saveRecordingUpload,websiteRecordingLibrary} from '../../src/website-recordings.js';
import {mediaFixtures} from '../media-fixtures.js';

test('upload, play and replace an authored recording and captions using portable website files',async({page})=>{
 test.setTimeout(90000);
 test.skip(!(await mediaCapabilities()).available,'Requires FFmpeg and FFprobe');
 const root=await mkdtemp(path.join(os.tmpdir(),'website-recording-browser-'));let server;
 try{
  await mkdir(path.join(root,'.observanda'));
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.storageKind=workspace.catalogue=()=>{throw Error('Research is unavailable');};
  const store=new WebsiteFileStore(workspace),fixtures=await mediaFixtures(root);let opened=await store.create({name:'Recordings'}),publication=null;
  server=http.createServer((req,res)=>{void (async()=>{
    const url=new URL(req.url,'http://127.0.0.1'),p=url.pathname,json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    if(p==='/editor'){res.setHeader('content-type','text/html');res.end('<main></main><div role="alert"></div>');return;}
    if(p==='/open')return json(opened);
    if(p==='/media/library'){const chunks=[];for await(const c of req)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks));return json(await websiteRecordingLibrary(store,data.siteId,data));}
    if(p==='/media/save'){opened=await saveRecordingUpload(store,await readRecordingUpload(req));publication=await WebsiteFilesCandidate.open(store,opened.site.id,opened.site.revision);await publication.verify();return json(opened);}
    if(/^\/website-[a-z-]+\.js$/.test(p)){res.setHeader('content-type','text/javascript');res.end(await readFile(new URL('../../src/web'+p,import.meta.url)));return;}
    if(p.startsWith('/site/')){const name=p.slice(6);const mime=name.endsWith('.html')?'text/html':name.endsWith('.vtt')?'text/vtt':name.endsWith('.wav')?'audio/wav':name.endsWith('.mp4')?'video/mp4':'text/css';
      if(publication?.files.has(name))return serveContent(req,res,publication.files.get(name),mime);}
    res.writeHead(404).end();
   })().catch(err=>res.writeHead(422).end(err.code??err.message));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  async function edit(index){
   await page.goto(base+'/editor');await page.evaluate(async index=>{
    const {websiteFilesRecordings}=await import('/website-files-recordings.js'),{websiteHTML}=await import('/website-html-document.js');
    let opened=await (await fetch('/open')).json(),tools;
    const request=async(p,data)=>{const binary=data instanceof Blob,response=await fetch('/'+p,{method:'POST',headers:{'Content-Type':binary?'application/octet-stream':'application/json'},body:binary?data:JSON.stringify(data)});if(!response.ok)throw Error(await response.text());return response.json();};
    const esc=value=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const render=()=>{document.querySelector('main').innerHTML=tools.view();tools.bind();};
    tools=websiteFilesRecordings({t:key=>key,esc,read:()=>websiteHTML(opened.html),site:()=>opened.site,path:()=>opened.path,css:()=>opened.css,url:name=>'/site/'+name,
     adopt:value=>{opened=value;},close:()=>document.querySelector('main').replaceChildren('saved'),request,render,run:fn=>fn(),notify:message=>document.querySelector('[role=alert]').textContent=message});
    await tools.open(null);render();if(index!==null){const control=document.querySelector('[data-recording-block]');control.value=String(index);control.dispatchEvent(new Event('change'));}
   },index);
  }
  async function checkPlayback(kind){
   await page.goto(base+'/site/index.html');
   const media=page.locator(kind);await expect(media).toHaveAttribute('preload','none');await expect(media).toHaveAttribute('controls','');
   await media.evaluate(async el=>{el.muted=true;await el.play();});await expect.poll(()=>media.evaluate(el=>el.currentTime)).toBeGreaterThan(0);
   await media.evaluate(el=>{el.textTracks[0].mode='showing';});
   await expect.poll(()=>media.evaluate(el=>el.textTracks[0].cues?.[0]?.text)).toBe('[Recorded tone]');
   await page.locator('summary').click();await expect(page.getByText('Described instrument observation')).toBeVisible();
  }
  await edit(null);await page.locator('input[name=upload]').setInputFiles(fixtures.audio.file);
  await page.locator('input[name=title]').fill('Instrument sound');await page.locator('textarea').fill('Described instrument observation');
  await page.locator('[name=vtt]').setInputFiles({name:'captions.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00.000 --> 00:00.350\n[Recorded tone]\n')});
  await page.locator('[name=language]').fill('en');await page.locator('[name=trackLabel]').fill('English');await page.locator('[name=defaultTrack]').check();
  await page.locator('button[type=submit]').click();await expect(page.locator('main')).toHaveText('saved');await checkPlayback('audio');
  await edit(0);await expect(page.locator('audio[data-recording-preview]')).toBeVisible();await page.locator('[name=kind]').selectOption('video');
  await page.locator('input[name=upload]').setInputFiles(fixtures.video.file);await page.locator('button[type=submit]').click();
  await expect(page.locator('main')).toHaveText('saved');await checkPlayback('video');
  expect([...publication.files.keys()].some(name=>name.endsWith('.wav'))).toBe(false);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
