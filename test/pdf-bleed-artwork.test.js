import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from '@cantoo/pdf-lib';
import {randomUUID} from 'node:crypto';
import {validPdfPress} from '../src/web/pdf-press-model.js';
import {validPdfBleedArtwork,pdfBleedBackgroundCSS,pdfBleedImageBox,pdfBleedPage} from '../src/web/pdf-bleed-model.js';
import {changePdfPress,attachPdfPressImage} from '../src/web/pdf-press-fields.js';
import {pdfPressArtworkUI} from '../src/web/pdf-press-artwork-ui.js';
import {preparePdfBleedImage,pdfBleedImageBytes} from '../src/pdf-bleed-artwork.js';
import {applyPdfPressGeometry} from '../src/pdf-press-geometry.js';
import {bleedPicture} from './fixtures/pdf-bleed-image.js';
const artwork=()=>({background:'#123456',image:null,pages:'all'}),press=()=>({version:2,bleedMm:3,cropMarks:true,artwork:artwork()});
test('bleed artwork keeps exact bounded values, physical cover crop and named physical-page selectors',()=>{
 const value=press();assert.equal(validPdfPress(value),true);for(const change of [{pages:'chapter'},{background:'red;display:none'},{image:{asset:'a'.repeat(64),crop:{x:-1,y:0}}},{extra:1}])assert.equal(validPdfBleedArtwork({...artwork(),...change}),false);
 assert.equal(pdfBleedBackgroundCSS(undefined,'','white'),'');assert.match(pdfBleedBackgroundCSS(value,'pdf-layout-2','#ffffff'),/@page pdf-layout-2\{background:transparent\}/);
 value.artwork.pages='first';assert.equal(pdfBleedPage(value.artwork,0),true);assert.equal(pdfBleedPage(value.artwork,1),false);assert.match(pdfBleedBackgroundCSS(value,'pdf-layout-2','#ffffff'),/pdf-layout-2:first/);
 value.artwork.pages='except-first';assert.equal(pdfBleedPage(value.artwork,0),false);assert.equal(pdfBleedPage(value.artwork,1),true);assert.match(pdfBleedBackgroundCSS(value,'pdf-layout-2','#ffffff'),/pdf-layout-2:first\{background:#ffffff\}/);assert.throws(()=>pdfBleedBackgroundCSS(value,'bad}#x{','#ffffff'));
 const box={x:-3,y:-3,width:106,height:206};assert.deepEqual(pdfBleedImageBox(box,{width:300,height:100},{x:100,y:50}),{x:-515,y:-3,width:618,height:206});assert.deepEqual(pdfBleedImageBox({x:0,y:0,width:200,height:100},{width:100,height:300},{x:50,y:0}),{x:0,y:-500,width:200,height:600});
 const header={press:{version:1,bleedMm:3,cropMarks:true}};changePdfPress(header,{dataset:{pdfPress:'artworkEnabled'},checked:true});assert.equal(header.press.version,2);assert.equal(attachPdfPressImage(header,bleedPicture()),true);changePdfPress(header,{dataset:{pdfPress:'cropX'},value:'75'});assert.equal(header.press.artwork.image.crop.x,75);changePdfPress(header,{dataset:{pdfPress:'artworkEnabled'},checked:false});assert.deepEqual(header.press,{version:1,bleedMm:3,cropMarks:true});
});
test('retained bleed pixels require exact hash, dimensions and pin; worker keeps original PDF bytes',async()=>{
 const picture=bleedPicture(),value=press();value.artwork.image={asset:picture.asset,crop:{x:0,y:100}};
 const image=await preparePdfBleedImage(value,async asset=>{assert.equal(asset,picture.asset);return picture;});assert.deepEqual(pdfBleedImageBytes(value,image),picture.content);
 for(const patch of [{asset:'b'.repeat(64)},{width:301},{data:image.data.slice(0,-4)+'AAAA'},{extra:1}])assert.throws(()=>pdfBleedImageBytes(value,{...image,...patch}),{code:'PDF_PRESS_FAILED'});
 assert.throws(()=>pdfBleedImageBytes(value,undefined),{code:'PDF_PRESS_FAILED'});assert.throws(()=>pdfBleedImageBytes(press(),image),{code:'PDF_PRESS_FAILED'});
 const document=await PDFDocument.create();document.addPage([300,400]).drawText('Original text');const bytes=Buffer.from(await document.save({useObjectStreams:false})),result=await applyPdfPressGeometry(bytes,value,{bleedImage:image});assert.deepEqual(result.subarray(0,bytes.length),bytes);assert.equal((await PDFDocument.load(result)).getPageCount(),1);
});
test('bleed image upload changes only its selected document and does not attach after deactivation',async()=>{
 let selected={header:{id:randomUUID(),press:press()}},resolve,changes=0;const calls=[],picture=bleedPicture();
 const ui=pdfPressArtworkUI({post:async(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});},getDocument:()=>selected,changed:()=>changes++,draw:()=>{},notify:message=>{throw Error(message);}}),element={dataset:{},hasAttribute:name=>name==='data-pdf-press-image',files:[new File([picture.content],'decorative.png')]};
 ui.input(element);await new Promise(done=>setTimeout(done,0));assert.equal(calls[0][0],'image-import');assert.deepEqual(Object.keys(calls[0][1]).sort(),['bytes','id']);resolve(picture);await ui.whenIdle();assert.equal(changes,1);assert.equal(selected.header.press.artwork.image.asset,picture.asset);
 ui.input(element);await new Promise(done=>setTimeout(done,0));ui.deactivate();resolve(picture);await ui.whenIdle();assert.equal(changes,1);
 ui.input(element);await new Promise(done=>setTimeout(done,0));selected={header:{id:randomUUID(),press:press()}};resolve(picture);await ui.whenIdle();assert.equal(changes,1);assert.equal(selected.header.press.artwork.image,null);ui.dispose();
});
