import test from 'node:test';
import assert from 'node:assert/strict';
import {applyVisualStyle,visualStyleFields,writeVisualStyle,generatedAppearanceProperties} from '../src/web/website-files-visual-style.js';
import {blockTypes} from '../src/web/website-files-blocks.js';
import en from '../src/web/locales/en/websiteFiles.json' with {type:'json'};

function fakeStyle(){
 const values=new Map();
 return {setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k),get length(){return values.size;},get cssText(){return [...values].map(([k,v])=>k+': '+v+';').join(' ');},values};
}

test('the block inspector offers space around, opacity and shadow as ordinary declarations',()=>{
 const fields=visualStyleFields({fonts:[]},key=>en[key]??key),byName=new Map(fields.map(f=>[f.name,f]));
 assert.equal(byName.get('margin').unit,'px');
 assert.deepEqual([byName.get('opacity').min,byName.get('opacity').max],[0,1]);
 assert.deepEqual(byName.get('box-shadow').options.map(([value])=>value)[0],'none');
 for(const field of fields)assert.ok(en[field.label],field.label);
 for(const name of ['margin','opacity','box-shadow'])assert.ok(generatedAppearanceProperties.has(name));
 const style=fakeStyle();
 applyVisualStyle(style,[['margin','24px'],['opacity','0.8'],['box-shadow',byName.get('box-shadow').options[2][0]],['unknown','1']]);
 assert.deepEqual([...style.values.keys()].sort(),['box-shadow','margin','opacity']);
 assert.match(writeVisualStyle('',('ow-visual-'+'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12)),style),/margin: 24px; opacity: 0\.8; box-shadow: rgba\(0, 0, 0, 0\.16\) 0px 4px 12px 0px;/);
});

test('the block menu offers an image and a video next to the gallery, each labelled',()=>{
 for(const key of ['image','video','gallery'])assert.ok(blockTypes.includes(key),key);
 for(const key of blockTypes)assert.ok(en[key==='heading'?'addHeading':key==='paragraph'?'addText':key],key);
});

test('a block or page can take a site picture as its background, sized, placed and overlaid visually',async()=>{
 const {backgroundPictureValue}=await import('../src/web/website-files-visual-style.js');
 const pictures=['pictures/11111111-1111-4111-8111-111111111111.png'];
 // The picture sits under an overlay layer drawn from its own colour and strength.
 const layer='color-mix(in srgb, var(--website-overlay-color, #000000) calc(var(--website-overlay-strength, 0) * 100%), transparent)';
 assert.equal(backgroundPictureValue(pictures[0],'style.css'),'linear-gradient('+layer+', '+layer+'), url("pictures/11111111-1111-4111-8111-111111111111.png")');
 assert.ok(backgroundPictureValue(pictures[0],'notes/2026/style.css').endsWith('url("../../pictures/11111111-1111-4111-8111-111111111111.png")'));
 const fields=visualStyleFields({fonts:[]},(key,args)=>(en[key]??key).replace(/\{(\w+)\}/g,(_,name)=>args?.[name]??''),{pictures,stylesheetPath:'notes/style.css'}),byName=new Map(fields.map(f=>[f.name,f]));
 assert.deepEqual(byName.get('background-image').options,[['none','No picture'],[backgroundPictureValue(pictures[0],'notes/style.css'),'Picture 1 (11111111)']]);
 assert.equal(byName.get('--website-overlay-color').type,'color');assert.deepEqual([byName.get('--website-overlay-strength').min,byName.get('--website-overlay-strength').max],[0,0.9]);
 // An overlay and a drop shadow are separate declarations on the same block.
 const both=fakeStyle();applyVisualStyle(both,[['--website-overlay-color','#102030'],['--website-overlay-strength','0.5'],['box-shadow','rgba(0, 0, 0, 0.16) 0px 4px 12px 0px']]);
 assert.deepEqual([...both.values.keys()].sort(),['--website-overlay-color','--website-overlay-strength','box-shadow']);
 for(const name of ['background-size','background-position','background-repeat'])assert.ok(byName.get(name).options.length>1,name);
 assert.ok(byName.get('box-shadow').options.some(([value])=>value.endsWith('100vmax inset')));
 for(const field of fields)assert.ok(en[field.label],field.label);
 const style=fakeStyle();applyVisualStyle(style,[['background-image',byName.get('background-image').options[1][0]],['background-size','cover']]);
 assert.deepEqual([...style.values.keys()],['background-image','background-size']);
});
