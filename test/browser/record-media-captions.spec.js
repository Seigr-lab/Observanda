import {test,expect} from '@playwright/test';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';

const captions='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nThe queen crosses the frame.\n\nnot a cue\n\n00:00:01.000 --> 00:00:02.000\nWorkers <b>follow</b>.\n';

test('a video gets a caption track in the media dialog, plays it in the reader and on a published page',async({page})=>{
 test.setTimeout(150000);
 const f=await mediaValueFixture({count:3}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const dialog=page.getByRole('dialog',{name:'Edit Media details',exact:true}),video=f.record.attachments[2];
 try{
  expect(video.kind).toBe('video');
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await page.getByRole('button',{name:'Edit media details for Media 2',exact:true}).click();
  const group=dialog.getByRole('group',{name:'Captions',exact:true});
  await expect(group.getByText('No captions yet.',{exact:true})).toBeVisible();
  await group.getByLabel('Language code (for example en, ca, nb)',{exact:true}).fill('en');
  await group.getByLabel('Label readers see',{exact:true}).fill('English');
  await group.getByLabel('WebVTT file',{exact:true}).setInputFiles({name:'inspection.en.vtt',mimeType:'text/vtt',buffer:Buffer.from(captions)});
  await expect(group.locator('[data-media-caption-error]')).toHaveText('Captions added: English');
  await expect(group.getByRole('listitem')).toHaveText(/English \(en\)/);
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await f.values.read(f.target(video.id))).value.value.captions;
  expect(saved).toEqual([{language:'en',label:'English',vtt:captions}]);
  // The reader's own player carries the track, served by the media route.
  await page.getByRole('button',{name:'Read record',exact:true}).click();
  const track=page.locator('video track[srclang="en"]').first();
  await expect(track).toHaveAttribute('kind','captions');await expect(track).toHaveAttribute('label','English');
  const src=await track.getAttribute('src');expect(src).toContain('/api/media/'+video.id+'/captions/en');expect(src).toContain('record='+f.record.id);
  const served=await page.evaluate(async url=>{const response=await fetch(url);return {status:response.status,type:response.headers.get('content-type'),text:await response.text()};},src);
  expect(served.status).toBe(200);expect(served.type).toContain('text/vtt');
  // The unreadable cue is left out; markup is shown as text.
  expect(served.text).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nThe queen crosses the frame.\n\n00:00:01.000 --> 00:00:02.000\nWorkers &lt;b&gt;follow&lt;/b&gt;.\n');
  // A published website page carries the same track beside the video.
  const read=await f.workspace.read(),record=read.book.entries.find(entry=>entry.id===f.record.id),book=read.book.notebooks.find(item=>item.id===record.notebookId);
  const project=read.book.projects.find(item=>item.id===book.projectId)??{id:book.projectId,title:'Project',share:true};
  const shared={...record,share:true,attachments:record.attachments.map(item=>({...item,share:item.id===video.id}))};
  const metadata={id:read.book.id,projects:[{...project,share:true}],notebooks:[{...book,share:true}]};
  const output=await convertPublicationRecord(f.workspace,metadata,shared,{target:'website'});
  expect(output.html).toMatch(/<track kind="captions" src="assets\/[a-f0-9]{64}\.vtt" srclang="en" label="English" default>/);
  const store=new WebsiteFileStore(f.workspace),siteId=randomUUID(),provenance={workspaceId:read.book.id,projectId:project.id,notebookId:book.id,recordId:record.id},sourceId=websiteSourceId({...provenance,target:'website'});
  const source=await store.putSource({sourceId,provenance,title:record.title,...output},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance})});
  let opened=await store.importFiles(siteId,{name:'Inspections',files:new Map([['index.html','<!doctype html><html lang="en"><head><title>Inspections</title></head><body><main><h1>Inspections</h1></main></body></html>'],['style.css','']])});
  opened=await store.insertSource(siteId,{path:'index.html',expectedRevision:opened.site.revision,sourceId,sourceRevision:source.revision});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(siteId);
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.frameLocator('#website-files-preview');
  await expect(preview.locator('video track[kind="captions"][srclang="en"]')).toHaveAttribute('label','English');
  expect(errors).toEqual([]);
 }finally{await app.close();await f.close();}
});
