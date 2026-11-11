import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCaptureMetadata} from '../src/media-capture-metadata.js';
import {mediaTechnical} from '../src/media.js';
import {captureMetadata} from '../src/web/record-media-values-ui.js';
import {mediaTechnicalList} from '../src/web/record-media-metadata.js';
import {emptyMediaMetadata,validMediaMetadata} from '../src/web/record-media-value.js';

// A little-endian TIFF block with IFD0, an Exif IFD and a GPS IFD.
function exifBlock({littleEndian=true}={}){
 const ifds=[],data=[];
 const ascii=text=>({type:2,bytes:Buffer.from(text+'\0','latin1')});
 const rational=pairs=>({type:5,bytes:Buffer.concat(pairs.map(([n,d])=>{const b=Buffer.alloc(8);littleEndian?(b.writeUInt32LE(n,0),b.writeUInt32LE(d,4)):(b.writeUInt32BE(n,0),b.writeUInt32BE(d,4));return b;}))});
 const byte=value=>({type:1,bytes:Buffer.from([value])});
 const long=value=>({type:4,bytes:(()=>{const b=Buffer.alloc(4);littleEndian?b.writeUInt32LE(value):b.writeUInt32BE(value);return b;})()});
 const ifd0=[[0x013b,ascii('A. Recorder')],[0x8298,ascii('CC BY 4.0 Field survey')],[0x010f,ascii('Maker')],[0x0110,ascii('Model 7')],[0x8769,null],[0x8825,null]];
 const exif=[[0x9003,ascii('2026:05:02 06:41:07')],[0x9011,ascii('+02:00')],[0x9291,ascii('25')]];
 const gps=[[1,ascii('N')],[2,rational([[59,1],[54,1],[4442,100]])],[3,ascii('W')],[4,rational([[10,1],[45,1],[43,10]])],[5,byte(0)],[6,rational([[1234,10]])]];
 const u16=v=>{const b=Buffer.alloc(2);littleEndian?b.writeUInt16LE(v):b.writeUInt16BE(v);return b;},u32=v=>{const b=Buffer.alloc(4);littleEndian?b.writeUInt32LE(v):b.writeUInt32BE(v);return b;};
 // Layout: header(8) | IFD0 | Exif IFD | GPS IFD | data area.
 const size=entries=>2+entries.length*12+4,ifd0At=8,exifAt=ifd0At+size(ifd0),gpsAt=exifAt+size(exif);let dataAt=gpsAt+size(gps);
 ifd0[4][1]=long(exifAt);ifd0[5][1]=long(gpsAt);
 const blocks=[];
 const write=entries=>{const parts=[u16(entries.length)];for(const [tag,value] of entries){const count=value.type===5?value.bytes.length/8:value.type===4?1:value.bytes.length;parts.push(u16(tag),u16(value.type),u32(count));if(value.bytes.length<=4)parts.push(Buffer.concat([value.bytes,Buffer.alloc(4-value.bytes.length)]));else{parts.push(u32(dataAt));blocks.push(value.bytes);dataAt+=value.bytes.length;}}parts.push(u32(0));return Buffer.concat(parts);};
 const header=Buffer.concat([Buffer.from(littleEndian?'II':'MM','latin1'),u16(42),u32(8)]);
 return Buffer.concat([header,write(ifd0),write(exif),write(gps),...blocks]);
}
const jpeg=tiff=>{const app1=Buffer.concat([Buffer.from('Exif\0\0','latin1'),tiff]),length=Buffer.alloc(2);length.writeUInt16BE(app1.length+2);return Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0,16]),Buffer.alloc(14),Buffer.from([0xff,0xe1]),length,app1,Buffer.from([0xff,0xda,0,2]),Buffer.alloc(64)]);};

test('camera details are read from JPEG and TIFF originals in either byte order',()=>{
 for(const littleEndian of [true,false]){
  const expected={creator:'A. Recorder',copyright:'CC BY 4.0 Field survey',description:'',camera:'Maker Model 7',capturedOn:'2026-05-02',capturedTime:'06:41:07.250+02:00',latitude:'59.912338889',longitude:'-10.751194444',altitude:'123.4'};
  assert.deepEqual(readCaptureMetadata(jpeg(exifBlock({littleEndian}))),expected);
  assert.deepEqual(readCaptureMetadata(exifBlock({littleEndian})),expected);
 }
});

test('files without camera details, damaged blocks and offsets outside the block are refused quietly',()=>{
 assert.equal(readCaptureMetadata(Buffer.from([0x89,0x50,0x4e,0x47,0,0,0,0,0,0])),null);
 assert.equal(readCaptureMetadata(Buffer.alloc(0)),null);
 const block=exifBlock();block.writeUInt32LE(0xffffff,4);assert.equal(readCaptureMetadata(block),null);
 const truncated=jpeg(exifBlock()).subarray(0,40);assert.equal(readCaptureMetadata(truncated),null);
});

test('camera details fill only empty media fields and become a private location',()=>{
 const capture=readCaptureMetadata(jpeg(exifBlock())),own={...emptyMediaMetadata(),creator:'Named by the author'};
 const merged=captureMetadata(own,capture);
 assert.equal(merged.creator,'Named by the author');assert.equal(merged.credit,'CC BY 4.0 Field survey');
 assert.equal(merged.capturedOn,'2026-05-02');assert.equal(merged.capturedTime,'06:41:07.250+02:00');
 assert.equal(merged.location,'59.912338889, -10.751194444 (123.4 m)');assert.ok(validMediaMetadata(merged));
 assert.deepEqual(own,{...emptyMediaMetadata(),creator:'Named by the author'},'The author value is never changed in place');
 const dated={...emptyMediaMetadata(),capturedOn:{kind:'year',value:'1911',estimated:true}};assert.deepEqual(captureMetadata(dated,capture).capturedOn,dated.capturedOn);
});

test('audio, video and image technical details keep the probed values exactly',()=>{
 const audio=mediaTechnical({format:{duration:'12.345678'},streams:[{codec_type:'audio',sample_rate:'96000',channels:2,channel_layout:'stereo',bits_per_raw_sample:'24',sample_fmt:'s32',codec_name:'flac'}]},'audio');
 assert.deepEqual(audio,{durationSeconds:'12.345678',sampleRate:96000,channels:2,channelLayout:'stereo',bitDepth:24,sampleFormat:'s32',audioCodec:'flac'});
 const video=mediaTechnical({format:{duration:'3.000'},streams:[{codec_type:'video',width:1920,height:1080,avg_frame_rate:'30000/1001',codec_name:'h264'},{codec_type:'audio',sample_rate:'48000',channels:1,sample_fmt:'fltp',codec_name:'aac'}]},'video');
 assert.equal(video.frameRate,'30000/1001');assert.equal(video.width,1920);assert.equal(video.sampleRate,48000);assert.equal(Object.hasOwn(video,'bitDepth'),false);
 assert.deepEqual(mediaTechnical({format:{},streams:[{codec_type:'video',width:4000,height:3000,codec_name:'mjpeg'}]},'image'),{width:4000,height:3000,codec:'mjpeg'});
 assert.deepEqual(mediaTechnical({format:{duration:'N/A'},streams:[{codec_type:'audio',sample_rate:'bad',channels:'2',codec_name:'x y'}]},'audio'),{});
 const esc=value=>String(value);const list=mediaTechnicalList(audio,esc);
 for(const part of ['12.345678 s','96,000 Hz','2 (stereo)','24 bit','flac'])assert.ok(list.includes(part),part);
 assert.equal(mediaTechnicalList(null,esc),'');
});
