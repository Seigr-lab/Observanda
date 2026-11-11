import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {mediaDetails,mediaThumbnail} from '../src/media-details.js';
import {contentBuffer} from '../src/file-content.js';
import {digest} from '../src/storage-format.js';

const generate=(directory,name,args)=>{const file=path.join(directory,name);execFileSync('ffmpeg',['-v','error','-n',...args,file],{windowsHide:true,stdio:'pipe',timeout:30000});return readFile(file);};
const bytesOf=async value=>Buffer.isBuffer(value)?value:contentBuffer(value,{maxBytes:value.size});

test('intake stores technical details and the camera details of an original are offered unchanged',async t=>{
 const f=await mediaValueFixture({count:1});t.after(f.close);
 const sound=await f.media.import(f.files.audio.bytes,'audio');
 const audio=await mediaDetails(f.media,sound.id);
 assert.equal(audio.kind,'audio');assert.equal(audio.capture,null);assert.equal(audio.technical.channels,1);assert.ok(audio.technical.sampleRate>0);assert.match(audio.technical.durationSeconds,/^0\.\d+$/);
 // A JPEG whose EXIF block names the photographer and position.
 const plain=await generate(f.directory,'photo.jpg',['-f','lavfi','-i','color=c=green:s=96x64','-frames:v','1']);
 const block=Buffer.concat([Buffer.from('4d4d002a00000008','hex'),Buffer.from('0001','hex'),Buffer.from('013b000200000006','hex'),Buffer.from('0000001a','hex'),Buffer.from('00000000','hex'),Buffer.from('4d6172696100','hex')]);
 const app1=Buffer.concat([Buffer.from('Exif\0\0','latin1'),block]),length=Buffer.alloc(2);length.writeUInt16BE(app1.length+2);
 const photo=Buffer.concat([plain.subarray(0,2),Buffer.from([0xff,0xe1]),length,app1,plain.subarray(2)]);
 const image=await f.media.import(photo,'image'),details=await mediaDetails(f.media,image.id);
 assert.equal(details.capture.creator,'Maria');assert.deepEqual({width:details.technical.width,height:details.technical.height},{width:96,height:64});
 const {metadata,directory}=await f.media.metadata(image.id);
 assert.equal(digest(await f.workspace.readFile(path.join(directory,'original'))),metadata.originalSha256,'The original is retained byte for byte');
 await assert.rejects(mediaDetails(f.media,randomUUID()),error=>!!error.code);
});

test('gallery thumbnails are reduced copies, cached and never larger than the display copy',async t=>{
 const f=await mediaValueFixture({count:1});t.after(f.close);
 const large=await f.media.import(await generate(f.directory,'large.png',['-f','lavfi','-i','color=c=blue:s=1200x800','-frames:v','1']),'image');
 const first=await mediaThumbnail(f.media,large.id,320),bytes=await bytesOf(first.bytes);
 assert.equal(first.width,320);assert.equal(first.height,213);assert.equal(bytes.readUInt32BE(16),320);assert.equal(bytes.readUInt32BE(20),213);
 const second=await mediaThumbnail(f.media,large.id,320);assert.ok(!Buffer.isBuffer(second.bytes),'The second request reads the cached copy');assert.deepEqual(await bytesOf(second.bytes),bytes);
 const small=f.record.attachments[0];const kept=await mediaThumbnail(f.media,small.id,160);assert.equal(kept.width,96);
 await assert.rejects(mediaThumbnail(f.media,large.id,200),{code:'INVALID'});
 const sound=await f.media.import(f.files.audio.bytes,'audio');await assert.rejects(mediaThumbnail(f.media,sound.id,160),{code:'INVALID'});
});
