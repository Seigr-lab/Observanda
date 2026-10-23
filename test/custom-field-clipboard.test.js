import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customFieldClipboardContext,validateCustomFieldClipboard} from '../src/web/custom-field-clipboard.js';
import {encodeNumeralClipboard,decodeNumeralClipboard} from '../src/web/numeral-clipboard.js';
import {templateFieldInput} from '../src/web/custom-field-input.js';
const context=(representation='radix-fraction',radix=6)=>({version:1,representation,radix});
const field=numeric=>({key:'counter',label:'Counter',type:'number',unit:'ticks',required:false,choices:[],...(numeric?{numeric}:{})});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('custom field clipboard admits only the saved interpretation and keeps exact spelling',()=>{
 for(const [representation,radix,spelling] of [['radix-fraction',6,'-0015.30'],['radix',6,'0010'],['integer',10,'9'.repeat(64)],['rational',10,'-001/3']]){
  const definition=field(context(representation,radix)),before=structuredClone(definition),fixed=customFieldClipboardContext(definition),payload=decodeNumeralClipboard(encodeNumeralClipboard({spelling,context:fixed}));
  validateCustomFieldClipboard(payload,{radix,representation,version:1});assert.equal(payload.spelling,spelling);assert.deepEqual(definition,before);
 }
 const definition=field(context()),before=structuredClone(definition),fixed=customFieldClipboardContext(definition);
 for(const incoming of [context('radix-fraction',8),context('decimal',10),context('text',10)])assert.throws(()=>validateCustomFieldClipboard(decodeNumeralClipboard(encodeNumeralClipboard({spelling:'10',context:incoming})),fixed),{code:'NUMERAL_CLIPBOARD_CONTEXT'});
 assert.deepEqual(definition,before);validateCustomFieldClipboard(decodeNumeralClipboard('10'),fixed);validateCustomFieldClipboard(decodeNumeralClipboard('ordinary invalid draft'),fixed);
});
test('legacy field clipboard context remains decimal and invalid typed envelopes cannot become plain values',()=>{
 const legacy=field(),before=structuredClone(legacy);assert.deepEqual(customFieldClipboardContext(legacy),context('decimal',10));assert.deepEqual(legacy,before);
 const encoded=encodeNumeralClipboard({spelling:'10',context:context()});assert.throws(()=>decodeNumeralClipboard(encoded.replace('"version":1','"version":99')),{code:'NUMERAL_CLIPBOARD_INVALID'});
 assert.throws(()=>customFieldClipboardContext(field({...context(),version:99})),{code:'NUMERAL_CLIPBOARD_INVALID'});
});
test('only numeric shared field controls expose pinned clipboard context',()=>{
 const numeric=templateFieldInput(field(context()),'-0015.30',{esc,attrs:'data-record-value'});assert.match(numeric,/data-custom-field-number=/);assert.match(numeric,/data-custom-field-spelling/);assert.match(numeric,/data-numeral-copy/);assert.match(numeric,/data-numeral-paste/);assert.ok(!numeric.includes('type="hidden"'));
 assert.ok(!templateFieldInput({...field(),type:'text'},'10',{esc}).includes('data-numeral-copy'));
});
