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
