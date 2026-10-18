import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {preparePdfFont,retainPdfDocumentFont,readPdfDocumentFont,describePdfDocumentFont,verifyPdfDocumentFonts} from '../src/pdf-document-fonts.js';
import {embedPdfFonts} from '../src/pdf-font-assets.js';
import {inspectFont} from '../src/font-inspector.js';
import {validPdfFontPin,validPdfFontPins} from '../src/web/pdf-font-model.js';
import {digest,serialize} from '../src/storage-format.js';

async function source({embed=true,restricted=false}={}){
 const bytes=await readFile(new URL('../src/fonts/atkinson.ttf',import.meta.url));
 if(restricted){for(let i=0;i<bytes.readUInt16BE(4);i++){const at=12+i*16;if(bytes.toString('ascii',at,at+4)==='OS/2'){bytes.writeUInt16BE(2,bytes.readUInt32BE(at+8)+8);break;}}}
 const info=inspectFont(bytes),id='custom-'+info.sha256,font={id,label:info.label,embed,restricted:false,hidden:false,faces:[{file:id+'.'+info.extension,style:info.style,weight:info.weight,axes:info.axes}]};
 const values=new Map([['.observanda/fonts/library.json',JSON.stringify([font])],['.observanda/fonts/'+id+'.json',JSON.stringify({bytes:bytes.toString('base64')})]]);
 return {id,bytes,values,workspace:{readMetadata:async name=>values.get(name)??null}};
}
function owner(){const values=new Map();return {values,store:{domain:'pdf',object:async key=>structuredClone(values.get(key)??null),putObject:async(key,value)=>values.set(key,structuredClone(value))}};}
const compiled=(id,pin)=>({version:1,html:'<!doctype html><html><head></head><body>Retained font</body></html>',fonts:[id],fontPins:[pin],glyphs:{[id]:[65,66,67]},equations:false});

test('PDF custom fonts retain exact approved bytes in bounded document-owned blocks after source removal',async()=>{
 const input=await source(),{store,values}=owner(),documentId=randomUUID();let checks=0;
 const prepared=await preparePdfFont(input.workspace,input.id,{check:async()=>checks++});assert.equal(checks,2);assert.equal(Object.isFrozen(prepared),true);
 const pin=await retainPdfDocumentFont(store,documentId,prepared);assert.ok(validPdfFontPin(pin));assert.ok(validPdfFontPins([pin]));assert.equal(validPdfFontPins([pin,pin]),false);assert.equal(validPdfFontPin({...pin,path:'font.ttf'}),false);
 const count=values.size;assert.deepEqual(await retainPdfDocumentFont(store,documentId,prepared),pin);assert.equal(values.size,count);assert.ok(count>2);assert.ok([...values.values()].every(value=>Buffer.byteLength(serialize(value))<=65536));
 const listing=await describePdfDocumentFont({...store,object:async key=>{assert.ok(key.startsWith('pdf-font:value:'));return store.object(key);}},documentId,pin);assert.equal(listing.id,pin.id);assert.equal(listing.revision,pin.revision);assert.equal(Object.hasOwn(listing,'bytes'),false);
 input.values.clear();const font=await readPdfDocumentFont(store,documentId,pin);assert.deepEqual(font.bytes,input.bytes);assert.equal(font.revision,pin.revision);assert.deepEqual(await verifyPdfDocumentFonts(store,{id:documentId,fonts:[pin]}),{fonts:1});
 const embedded=await embedPdfFonts(compiled(input.id,pin),{customFonts:new Map([[input.id,font]])});assert.ok(embedded.html.includes('data:font/ttf;base64,'+input.bytes.toString('base64')));assert.equal(embedded.fontBytes,input.bytes.length);
 await assert.rejects(embedPdfFonts(compiled(input.id,pin)),{code:'PDF_FONT'});await assert.rejects(embedPdfFonts(compiled(input.id,pin),{customFonts:new Map([[input.id,{...font,revision:'a'.repeat(64)}]])}),{code:'PDF_FONT'});
 await assert.rejects(embedPdfFonts({...compiled(input.id,pin),glyphs:{[input.id]:[0x10ffff]}},{customFonts:new Map([[input.id,font]])}),{code:'PDF_GLYPH'});
 await assert.rejects(readPdfDocumentFont(store,randomUUID(),pin),{code:'CATALOGUE_DAMAGED'});
});

test('PDF font capture enforces embedding consent, real font restrictions and cancellation before writes',async()=>{
 for(const options of [{embed:false},{restricted:true}]){const input=await source(options);await assert.rejects(preparePdfFont(input.workspace,input.id),{code:'FONT_EMBED'});}
 const input=await source(),{store,values}=owner(),controller=new AbortController();controller.abort();await assert.rejects(preparePdfFont(input.workspace,input.id,{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(retainPdfDocumentFont(store,randomUUID(),{id:input.id}),{code:'INVALID'});assert.equal(values.size,0);
 const prepared=await preparePdfFont(input.workspace,input.id);await assert.rejects(retainPdfDocumentFont(store,randomUUID(),prepared,{signal:controller.signal}),{name:'AbortError'});assert.equal(values.size,0);
});

test('PDF retained font reads reject substituted blocks, descriptors and oversized roots before hydration',async()=>{
 const input=await source(),{store,values}=owner(),documentId=randomUUID(),pin=await retainPdfDocumentFont(store,documentId,await preparePdfFont(input.workspace,input.id));
 const key='pdf-font:value:'+documentId+':'+pin.revision,descriptor=values.get(key);values.set(key,{...descriptor,documentId:randomUUID()});await assert.rejects(readPdfDocumentFont(store,documentId,pin),{code:'CATALOGUE_DAMAGED'});values.set(key,descriptor);
 const block=[...values].find(([,value])=>value.type==='bytes'),old=block[1];values.set(block[0],{...old,value:'AAAA'});await assert.rejects(readPdfDocumentFont(store,documentId,pin),{code:'CATALOGUE_DAMAGED'});values.set(block[0],old);
 const rootKey='pdf-font:block:'+documentId+':value:'+descriptor.root,root=values.get(rootKey),oversized={...root,bytes:root.bytes+32768,root:{...root.root,count:root.root.count+1}},revision=digest(serialize(oversized));values.set('pdf-font:block:'+documentId+':value:'+revision,oversized);
 const forged={...descriptor,root:revision},forgedRevision=digest(serialize(forged));values.set('pdf-font:value:'+documentId+':'+forgedRevision,forged);let reads=0;const bounded={...store,object:async key=>{reads++;return store.object(key);}};
 await assert.rejects(readPdfDocumentFont(bounded,documentId,{...pin,revision:forgedRevision}),{code:'CATALOGUE_DAMAGED'});assert.ok(reads<=2);
 assert.deepEqual((await readPdfDocumentFont(store,documentId,pin)).bytes,input.bytes);
});
