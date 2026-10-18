import {pdfEditorFonts} from '../src/web/pdf-editor-fonts.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pdfFontChoices,pdfInlineFontIds,pdfSectionFontIds} from '../src/web/pdf-font-model.js';
import {fontSelect} from '../src/web/font-picker.js';
import {textTools} from '../src/web/text-tools.js';
import {BUNDLED_FONTS} from '../src/web/font-catalogue.js';
const custom='custom-'+'a'.repeat(64),other='custom-'+'b'.repeat(64),prose=font=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact typography',marks:[{type:'font_family',attrs:{font}}]}]}]});
test('PDF inline font choices exclude system and restricted fonts without changing other editors',()=>{
 const choices=pdfFontChoices([{id:custom,label:'Retained font',embed:true,restricted:false,hidden:true},{id:other,label:'Restricted font',embed:true,restricted:true},{id:'custom-'+'c'.repeat(64),label:'Local only',embed:false,restricted:false}]);
 assert.equal(choices.length,BUNDLED_FONTS.length+1);assert.equal(choices.at(-1)[0],custom);
 const toolbar=textTools({compact:true,fonts:choices});assert.ok(toolbar.includes(custom));assert.ok(!toolbar.includes(other));assert.ok(!toolbar.includes('value="modern"'));assert.ok(!toolbar.includes('value="editorial"'));assert.ok(fontSelect('',null).includes('value="modern"'));
});
test('selected PDF font discovery includes notes and layout without treating retained provenance as visible content',()=>{
 const section={content:prose(custom),layout:{font:'atkinson'},notes:[{content:prose(other)}],research:{content:prose('modern')}};
 assert.deepEqual(pdfInlineFontIds(section.content),[custom]);assert.deepEqual(pdfSectionFontIds(section),['atkinson',custom,other]);
});

test('PDF editor font clear remains reusable while disposal cancels late reads and permanently closes the loader',async t=>{
 const oldDocument=globalThis.document,oldFontFace=globalThis.FontFace,faces=new Set(),errors=[],reads=[];
 globalThis.document={fonts:faces};globalThis.FontFace=class{constructor(family,bytes){this.family=family;this.bytes=bytes;}async load(){return this;}};
 t.after(()=>{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;if(oldFontFace===undefined)delete globalThis.FontFace;else globalThis.FontFace=oldFontFace;});
 const drain=()=>new Promise(resolve=>setImmediate(resolve)),blob=new Blob([new Uint8Array([1,2,3])]),font={id:custom,faces:[{style:'normal',weight:[400],axes:{}}]},selected={header:{id:'document',layout:{font:custom},fonts:[{id:custom,revision:'pin'}]},revision:'edition'};
 let finish;const loader=pdfEditorFonts({read:async(data,{signal})=>{reads.push({data,signal});return reads.length===3?new Promise(resolve=>{finish=resolve;}):blob;},notify:error=>errors.push(error)});
 loader.update(selected,null,[font]);await drain();assert.equal(faces.size,1);loader.clear();assert.equal(faces.size,0);
 loader.update(selected,null,[font]);await drain();assert.equal(faces.size,1);assert.equal(reads.length,2);loader.clear();loader.update(selected,null,[font]);assert.equal(reads.length,3);
 loader.dispose();assert.equal(reads[2].signal.aborted,true);finish(blob);await drain();loader.update(selected,null,[font]);await drain();assert.equal(reads.length,3);assert.equal(faces.size,0);assert.deepEqual(errors,[]);
});
