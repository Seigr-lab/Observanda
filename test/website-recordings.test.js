import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {contentBuffer} from '../src/file-content.js';
import {mediaCapabilities} from '../src/media.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {plainWebVTT,readRecordingUpload,saveRecordingUpload,websiteRecordingLibrary} from '../src/website-recordings.js';
import {mediaFixtures,PRIVATE_MARKER} from './media-fixtures.js';

const cues='WEBVTT\n\n00:00.000 --> 00:00.350\n[Instrument tone]\n';
const envelope=(data,bytes)=>{
 const json=Buffer.from(JSON.stringify(data)),size=Buffer.alloc(4);size.writeUInt32BE(json.length);
 return Readable.from((function*(){yield size.subarray(0,2);yield size.subarray(2);yield json;for(let i=0;i<bytes.length;i+=997)yield bytes.subarray(i,i+997);})());
};
test('timed track parser admits caption text, ignores notes, and rejects malformed timing',()=>{
 assert.match(plainWebVTT('WEBVTT\r\n\r\nNOTE private metadata\r\n\r\n1\r\n00:00.000 --> 00:01.000\r\n<v speaker>Sound'),/00:01\.000\n&lt;v speaker&gt;Sound/);
 assert.doesNotMatch(plainWebVTT(cues),/NOTE/);
 for(const text of ['WEBVTT','WEBVTT\n\n00:00.900 --> 00:00.200\nText','WEBVTT\n\nSTYLE\n::cue {background:red}'])assert.throws(()=>plainWebVTT(text),{code:'INVALID'});
});

test('streamed website recordings and captions survive publication, reuse, replacement and withdrawal with research offline',async t=>{
 if(!(await mediaCapabilities()).available)return t.skip('Requires FFmpeg and FFprobe');
 const root=await mkdtemp(path.join(os.tmpdir(),'website-recordings-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const fixtures=await mediaFixtures(root),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=workspace.storageKind=()=>assert.fail('Opened research');const store=new WebsiteFileStore(workspace);
 let opened=await store.create({name:'Acoustic observations'});
 opened=await store.createPage(opened.site.id,{expectedRevision:opened.site.revision,path:'notes.html',title:'Notes',inclusion:'included'});
 opened=await store.open(opened.site.id);
 for(const kind of ['audio','video']){
  const {bytes}=fixtures[kind],name='recordings/'+randomUUID()+(kind==='audio'?'.wav':'.mp4'),track='recordings/'+randomUUID()+'.vtt';
  const segment='<figure><'+kind+' controls preload="none" src="'+name+'"><track kind="captions" srclang="en" label="English" src="'+track+'"></'+kind+'></figure>';
  const data={siteId:opened.site.id,expectedRevision:opened.site.revision,path:'index.html',html:opened.html.replace('</main>',segment+'</main>'),css:opened.css,recording:{name,size:bytes.length,label:'Laboratory recording'},tracks:[{name:track,text:cues}]};
  opened=await saveRecordingUpload(store,await readRecordingUpload(envelope(data,bytes)));
  const page=await websiteRecordingLibrary(store,opened.site.id,{path:'index.html',expectedRevision:opened.site.revision});assert.ok(page.items.some(item=>item.name===name));
  const candidate=await WebsiteFilesCandidate.open(store,opened.site.id,opened.site.revision,{blockedValues:[PRIVATE_MARKER]});await candidate.verify();
  const copy=await contentBuffer(candidate.files.get(name),{maxBytes:4*1024*1024});assert.ok(copy.length);assert.ok(!copy.includes(Buffer.from(PRIVATE_MARKER)));
  assert.equal((await contentBuffer(candidate.files.get(track),{maxBytes:8192})).toString(),cues);
  assert.deepEqual(await readdir(path.join(root,'.observanda','website-files','recording-stage')),['writer']);
  await assert.rejects(()=>saveRecordingUpload(store,{data,uploads:[],bytes:()=>{throw Error('Read stale upload');}}),{code:'CONFLICT'});
  const referenced=await store.save(opened.site.id,{...opened,expectedRevision:opened.site.revision,path:'notes.html',html:'<title>Notes</title>'+segment});
  opened=await store.open(opened.site.id);opened=await store.save(opened.site.id,{...opened,expectedRevision:referenced.site.revision,html:opened.html.replace(segment,'')});
  assert.ok((await store.export(opened.site.id,{expectedRevision:opened.site.revision})).files.has(name));
  const next=await store.save(opened.site.id,{expectedRevision:opened.site.revision,path:'notes.html',html:'<title>Notes</title><p>Removed</p>',css:opened.css});
  const retired=await store.export(opened.site.id,{expectedRevision:next.site.revision});assert.ok(!retired.files.has(name));assert.ok(!retired.files.has(track));opened=await store.open(opened.site.id);
 }
});
