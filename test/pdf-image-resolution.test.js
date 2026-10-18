import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {validPdfImageOutputDpi,planPdfImageResolution} from '../src/web/pdf-image-resolution-model.js';
import {applyPdfImageResolution,pdfImageResolutionScript} from '../src/pdf-image-resolution.js';

const dimensions={naturalWidth:1000,naturalHeight:1000,widthPx:400,heightPx:200};
test('resolution planner uses actual contain and cover scale and never upscales',()=>{
 const contain=planPdfImageResolution({...dimensions,fit:'contain',outputDpi:96}),cover=planPdfImageResolution({...dimensions,fit:'cover',outputDpi:96});
 assert.deepEqual([contain.width,contain.height,contain.sourceDpi,contain.effectiveDpi],[200,200,480,96]);
 assert.deepEqual([cover.width,cover.height,cover.sourceDpi,cover.effectiveDpi],[400,400,240,96]);
 for(const outputDpi of [undefined,null,1200]){const result=planPdfImageResolution({...dimensions,outputDpi});assert.equal(result.downsample,false);assert.equal(result.width,1000);assert.equal(result.height,1000);}
 const portrait=planPdfImageResolution({naturalWidth:1001,naturalHeight:2003,widthPx:127,heightPx:200,outputDpi:150});assert.ok(portrait.width<=1001&&portrait.height<=2003);assert.ok(portrait.effectiveDpi>=150);assert.equal(portrait.originalPixels,1001*2003);assert.equal(portrait.pixels,portrait.width*portrait.height);
 const tiny=planPdfImageResolution({naturalWidth:1,naturalHeight:100,widthPx:0.001,heightPx:0.1,outputDpi:72});assert.equal(tiny.width,1);assert.equal(tiny.height,1);
});

test('resolution admission refuses malformed geometry, unsupported settings and excess decoded pixels',()=>{
 for(const value of [undefined,null,72,300,1200])assert.equal(validPdfImageOutputDpi(value),true);
 for(const value of [0,71,1201,72.5,'300',false,NaN,Infinity]){assert.equal(validPdfImageOutputDpi(value),false);assert.throws(()=>planPdfImageResolution({...dimensions,outputDpi:value}),TypeError);}
 for(const value of [{naturalWidth:0},{naturalHeight:1.5},{naturalWidth:100000,naturalHeight:100000},{widthPx:0},{heightPx:NaN},{widthPx:Infinity},{fit:'fill'}])assert.throws(()=>planPdfImageResolution({...dimensions,...value}),TypeError);
});

// The DOM/codec seam below records exact sequencing and byte accounting; actual
// PNG decoding/encoding belongs to the connected Chromium quality-preview case.
function fixture(options=[{}],{style='padding:2mm',nullBlob=false}={}){
 const events=[],encoded=new Map(),canvases=[],attrs=new Map([['data-pdf-width-mm','170'],['data-pdf-section-id','11111111-1111-4111-8111-111111111111']]);if(style!==null)attrs.set('style',style);
 const section={id:'pdf-section-11111111-1111-4111-8111-111111111111',getAttribute:name=>attrs.get(name)??null,setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),style:{setProperty(name,value,priority){attrs.set('style',(attrs.get('style')??'')+';'+name+':'+value+'!'+priority);}}};
 const url=(width,height,length=1000)=>{const bytes=Buffer.alloc(length,17);bytes.writeUInt32BE(width,0);bytes.writeUInt32BE(height,4);const value='data:image/png;base64,'+bytes.toString('base64');encoded.set(value,{width,height});return value;};
 const images=options.map((option,index)=>{const original=url(option.naturalWidth??1000,option.naturalHeight??1000,option.bytes??1000),attributes=new Map();if(option.dpi!==null)attributes.set('data-pdf-output-dpi',String(option.dpi??96));const figure={getAttribute:name=>name==='data-pdf-block-id'?'22222222-2222-4222-8222-'+String(index+1).padStart(12,'0'):null};
  return {index,original,src:option.src??original,srcset:option.srcset??'',fit:option.fit??'contain',naturalWidth:option.naturalWidth??1000,naturalHeight:option.naturalHeight??1000,get currentSrc(){return this.src;},getAttribute:name=>attributes.get(name)??null,closest:selector=>selector==='.pdf-section'?section:figure,getBoundingClientRect(){assert.match(attrs.get('style'),/width:170mm!important/);return {width:option.widthPx??400,height:option.heightPx??200};},async decode(){events.push('decode:'+index);if(option.decodeError)throw new Error('decoder failed');const value=encoded.get(this.src);if(value){this.naturalWidth=value.width;this.naturalHeight=value.height;}},attributes};
 });
 const view={getComputedStyle:image=>({objectFit:image.fit}),FileReader:class{readAsDataURL(blob){events.push('read');blob.arrayBuffer().then(value=>{this.result='data:image/png;base64,'+Buffer.from(value).toString('base64');this.onload();},error=>{this.error=error;this.onerror();});}}};
 const doc={fonts:{ready:Promise.resolve()},defaultView:view,createElement(name){assert.equal(name,'canvas');let current=null;const canvas={width:0,height:0,getContext(type,settings){assert.equal(type,'2d');assert.deepEqual(settings,{alpha:true});return {drawImage(image,x,y,width,height){current=image;events.push('draw:'+image.index);assert.deepEqual([x,y,width,height],[0,0,canvas.width,canvas.height]);}};},toBlob(callback,type){assert.equal(type,'image/png');events.push('blob:'+current.index);const content=url(canvas.width,canvas.height,Math.max(8,Math.round(canvas.width*canvas.height/1000))),blob=new Blob([Buffer.from(content.slice(22),'base64')],{type:'image/png'});queueMicrotask(()=>callback(nullBlob?null:blob));}};canvases.push(canvas);return canvas;}};
 const root={ownerDocument:doc,matches:()=>false,querySelectorAll:selector=>selector==='.pdf-section'?[section]:selector==='.pdf-placed-image > img'?images:[]};doc.querySelectorAll=root.querySelectorAll;return {root,doc,section,images,events,canvases,attrs,style};
}

test('trusted DOM operation sequentially downsamples, reports real byte totals and restores physical section styles',async()=>{
 const f=fixture([{fit:'contain'},{fit:'cover'},{dpi:null}]),originals=f.images.map(image=>image.src),result=await applyPdfImageResolution(planPdfImageResolution,{root:f.root});
 assert.equal(f.attrs.get('style'),f.style);assert.equal(result.images,3);assert.equal(result.changed,2);assert.equal(result.beforeBytes,3000);assert.equal(result.afterBytes,40+160+1000);assert.equal(result.beforePixels,3000000);assert.equal(result.afterPixels,40000+160000+1000000);
 assert.deepEqual(result.items.map(row=>[row.after.width,row.after.height,row.changed]),[[200,200,true],[400,400,true],[1000,1000,false]]);assert.equal(result.items[0].sectionId,'11111111-1111-4111-8111-111111111111');assert.equal(result.items[0].imageId,'22222222-2222-4222-8222-000000000001');assert.equal(result.items[2].requestedDpi,null);assert.equal(result.truncated,false);
 assert.deepEqual(f.events,['decode:0','draw:0','blob:0','read','decode:0','decode:1','draw:1','blob:1','read','decode:1','decode:2']);assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0));assert.deepEqual(f.images.map(image=>image.original),originals);assert.equal(f.images[2].src,originals[2]);
});

test('original resolution performs no reencoding and bounds per-image metrics without losing totals',async()=>{
 const f=fixture(Array.from({length:260},()=>({naturalWidth:1,naturalHeight:1,bytes:8,dpi:null})),{style:null}),result=await applyPdfImageResolution(planPdfImageResolution,{root:f.root});
 assert.equal(f.attrs.has('style'),false);assert.equal(f.canvases.length,0);assert.equal(result.images,260);assert.equal(result.changed,0);assert.equal(result.items.length,256);assert.equal(result.truncated,true);assert.equal(result.beforeBytes,2080);assert.equal(result.afterBytes,2080);assert.equal(result.beforePixels,260);assert.equal(result.afterPixels,260);
});

test('failed source, geometry or encoding never conceals errors and always restores section styles',async()=>{
 for(const options of [{dpi:'96x'},{dpi:'71'},{srcset:'remote.png 2x'},{src:'https://example.invalid/image.png'},{src:'data:image/png;base64,?bad'},{widthPx:0},{naturalWidth:100000,naturalHeight:100000},{decodeError:true}]){const f=fixture([options]);await assert.rejects(applyPdfImageResolution(planPdfImageResolution,{root:f.root}),{code:'PDF_IMAGE_RESOLUTION_FAILED'});assert.equal(f.attrs.get('style'),f.style);}
 const f=fixture([{}],{nullBlob:true}),original=f.images[0].src;await assert.rejects(applyPdfImageResolution(planPdfImageResolution,{root:f.root}),{code:'PDF_IMAGE_RESOLUTION_FAILED'});assert.equal(f.images[0].src,original);assert.equal(f.attrs.get('style'),f.style);assert.ok(f.canvases.every(canvas=>canvas.width===0&&canvas.height===0));
 const invalid=fixture();invalid.attrs.set('data-pdf-width-mm','0');await assert.rejects(applyPdfImageResolution(planPdfImageResolution,{root:invalid.root}),{code:'PDF_IMAGE_RESOLUTION_FAILED'});assert.equal(invalid.attrs.get('style'),invalid.style);
});

test('desktop script embeds the same planner without importing browser module bindings',async()=>{
 const f=fixture([{dpi:null}]);const result=await vm.runInNewContext(pdfImageResolutionScript,{document:f.doc});assert.equal(result.images,1);assert.equal(result.changed,0);assert.equal(result.items[0].before.width,1000);assert.equal(f.attrs.get('style'),f.style);
});
