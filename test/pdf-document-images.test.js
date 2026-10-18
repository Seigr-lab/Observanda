import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {preparePdfImage,PdfDocumentImages,verifyPdfImages} from '../src/pdf-document-images.js';
import {pdfImagePlacement,validPdfImage,validPdfImages,PDF_IMAGE_MAX_BYTES} from '../src/web/pdf-image-model.js';
import {pdfImagesUI} from '../src/web/pdf-images-ui.js';
import {digest} from '../src/storage-format.js';
function memory(data=new Map()){
 const store={domain:'pdf',async object(key){return structuredClone(data.get(key)??null);},async putObject(key,value){data.set(key,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...data.keys()].sort())if(key.startsWith(prefix))yield key;}};return {store,data};
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;}
function picture(marker='synthetic-camera-comment'){
 const width=128,height=128,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc(height*(width*3+1));let seed=97;for(let row=0;row<height;row++)for(let i=1;i<=width*3;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[row*(width*3+1)+i]=seed>>>24;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0'+marker)),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('PDF images sanitize real raster input, retain exact immutable bytes and reject tampering or another document',{timeout:60000},async()=>{
 const {store,data}=memory(),id=randomUUID(),images=new PdfDocumentImages(store,id),source=picture(),prepared=await preparePdfImage(source),asset=await images.retain(prepared);
 assert.deepEqual({width:asset.width,height:asset.height,mime:asset.mime},{width:128,height:128,mime:'image/png'});assert.equal(asset.asset,prepared.asset);assert.equal(Object.hasOwn(asset,'root'),false);
 const output=await images.read(asset.asset);assert.equal(digest(output.content),asset.asset);assert.equal(output.content.includes(Buffer.from('synthetic-camera-comment')),false);assert.equal(output.content.includes(Buffer.from('tEXt')),false);assert.ok(data.size>4,'Synthetic pixels must exercise multiple immutable tree blocks');
 const before=data.size;assert.deepEqual(await images.retain(prepared),asset);assert.equal(data.size,before);
 assert.equal((await preparePdfImage(picture('different-camera-comment'))).asset,asset.asset);
 await assert.rejects(images.retain({...prepared}),{code:'INVALID'});await assert.rejects(new PdfDocumentImages(store,randomUUID()).read(asset.asset),{code:'NOT_FOUND'});
 const restored=memory(structuredClone(data));assert.deepEqual((await new PdfDocumentImages(restored.store,id).read(asset.asset)).content,output.content);assert.equal((await verifyPdfImages(restored.store)).images,1);
 const key=[...data.keys()].find(key=>key.startsWith('pdf:image-block:')&&key.includes(':value:')),original=data.get(key);data.set(key,{type:'inline',value:'substitution'});await assert.rejects(images.read(asset.asset),{code:'CATALOGUE_DAMAGED'});data.set(key,original);
 const descriptorKey='pdf:image:'+id+':'+asset.asset,descriptor=data.get(descriptorKey);data.set(descriptorKey,{...descriptor,width:129});await assert.rejects(images.read(asset.asset),{code:'CATALOGUE_DAMAGED'});data.set(descriptorKey,descriptor);
 const controller=new AbortController();controller.abort();await assert.rejects(images.read(asset.asset,{signal:controller.signal}),{name:'AbortError'});assert.equal((await verifyPdfImages(store)).images,1);
});
test('PDF image preparation refuses external or unsupported content and cancellation before allocation',async()=>{
 for(const value of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.from('https://example.invalid/image.png'),Buffer.from('GIF89a')])await assert.rejects(preparePdfImage(value),{code:'MEDIA_INVALID'});
 await assert.rejects(preparePdfImage(Buffer.alloc(PDF_IMAGE_MAX_BYTES+1)),{code:'MEDIA_LIMIT'});
 const controller=new AbortController();controller.abort();await assert.rejects(preparePdfImage(picture(),{signal:controller.signal}),{name:'AbortError'});
 assert.throws(()=>new PdfDocumentImages({domain:'research'},randomUUID()),{code:'INVALID'});
});
test('PDF image placements keep physical size, crop and section position while requiring explicit alternative text',()=>{
 const value=pdfImagePlacement({asset:'a'.repeat(64),width:300,height:200},{id:randomUUID(),alt:'Synthetic specimen',caption:'Measured view',block:5,widthMm:90});
 assert.equal(value.heightMm,60);assert.equal(validPdfImage(value),true);assert.equal(validPdfImages([value]),true);
 for(const changed of [{alt:''},{asset:'https://example.invalid/image.png'},{widthMm:0},{crop:{x:101,y:50}},{position:{block:12001,align:'center'}}])assert.equal(validPdfImage({...value,...changed}),false);
 assert.equal(validPdfImages([value,value]),false);
});
test('image UI imports only selected bytes, requires alt before attach, and ignores upload completion after context changes',async()=>{
 let document={header:{id:randomUUID()}},section={id:randomUUID()},changes=0,resolve,request;const notices=[];
 const asset={asset:'b'.repeat(64),mime:'image/png',size:100,width:100,height:80};
 const ui=pdfImagesUI({post:async(...args)=>{request=args;return new Promise(done=>{resolve=done;});},esc:value=>String(value),getDocument:()=>document,getSection:()=>section,changed:()=>changes++,draw:()=>{},notify:value=>notices.push(value)});
 ui.view();const input={hasAttribute:name=>name==='data-pdf-image-file',files:[new File([new Uint8Array([1,2,3])],'unretained-source.png')]};assert.equal(ui.input(input),true);await new Promise(done=>setTimeout(done,0));assert.equal(request[0],'image-import');assert.deepEqual(Object.keys(request[1]).sort(),['bytes','id']);resolve(asset);await ui.whenIdle();
 await assert.rejects(ui.action('image-add',{}));assert.equal(changes,0);
 ui.input({hasAttribute:()=>false,dataset:{pdfImageNew:'alt'},value:'Selected specimen'});await ui.action('image-add',{});assert.equal(changes,1);assert.equal(section.images[0].alt,'Selected specimen');assert.equal(validPdfImage(section.images[0]),true);
 assert.equal(ui.input(input),true);await new Promise(done=>setTimeout(done,0));section={id:randomUUID()};resolve(asset);await ui.whenIdle();ui.view();await ui.action('image-add',{});assert.equal(section.images,undefined);assert.equal(changes,1);assert.deepEqual(notices,[]);ui.dispose();
});
