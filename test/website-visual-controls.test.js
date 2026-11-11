import test from 'node:test';
import assert from 'node:assert/strict';
import {applyVisualStyle,visualStyleFields,writeVisualStyle,generatedAppearanceProperties} from '../src/web/website-files-visual-style.js';
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

