import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldPage,moduleSchemaFields} from '../src/web/modules/schema-fields.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(key,label=key)=>({key,label,type:'text',unit:'',required:false,choices:[]});
function fixture(data){
 let html='',editor;const c={current:{data},esc,field:(label,control)=>`<label>${label}</label>${control}`,option:(id,label)=>`<option value="${esc(id)}">${esc(label)}</option>`,button:label=>esc(label),draw:()=>{html=editor.view({edit:true});}};
 editor=moduleSchemaFields(c);return {editor,get html(){return html;}};
}
test('schema search retains only a page of positions and clamps empty or shortened results',()=>{
 const values=Array.from({length:65000},(_,i)=>'Field '+i);
 assert.deepEqual(fieldPage(values,{query:'Field 6499'}),{positions:[6499,64990,64991,64992,64993,64994,64995,64996,64997,64998],total:11,offset:0});
 assert.deepEqual(fieldPage(values,{query:'Field 6499',offset:30}),{positions:[64999],total:11,offset:10});
 assert.deepEqual(fieldPage(values,{query:'absent',offset:30}),{positions:[],total:0,offset:0});
});
test('invalid off-page schema choices and values reveal the owning field without discarding other values',()=>{
 const fields=Array.from({length:25},(_,i)=>field('f'+i));fields[24]={...fields[24],type:'select',choices:Array.from({length:61},(_,i)=>String(i))};fields[24].choices[60]='';
 const edit=fixture({fields});assert.throws(()=>edit.editor.validate({edit:true}),/Review f24/);
 assert.ok(edit.html.includes('data-schema-index="24"'));assert.ok(edit.html.includes('data-schema-choice="60"'));assert.ok(!edit.html.includes('data-schema-choice="0"'));
 fields[24].choices[60]='0';assert.throws(()=>edit.editor.validate({edit:true}),/Review f24/);assert.ok(edit.html.includes('data-schema-choice="60"'));
 fields[24].choices[60]='60';fields[24].required=true;const values={f0:'Keep hidden input'},value=fixture({fieldSchema:fields,values});
 assert.throws(()=>value.editor.validate(),/Review f24/);assert.deepEqual(values,{f0:'Keep hidden input'});
 values.f24='60';assert.doesNotThrow(()=>value.editor.validate());
});
test('schema value labels and units stay text, and a large choice list renders at most one page plus its current value',()=>{
 const value=fixture({fieldSchema:[field('text','<img src=x onerror=alert(1)>'),{...field('choice'),type:'select',choices:Array.from({length:6500},(_,i)=>String(i))}],values:{choice:'6499'}}),html=value.editor.view();
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.equal((html.match(/<option /g)??[]).length,22);assert.ok(html.includes('value="6499"'));
});

test('inventory schemas and values share declared numeral formats without converting their spelling',()=>{
 const f=field('counter'),data={fields:[f]},edit=fixture(data),input=(key,value)=>edit.editor.input({dataset:{schemaIndex:'0',schemaProperty:key},value});
 input('type','number');input('numericRepresentation','radix');input('numericRadix','6');assert.doesNotThrow(()=>edit.editor.validate({edit:true}));assert.deepEqual(f.numeric,{version:1,representation:'radix',radix:6});
 const resource={fieldSchema:structuredClone(data.fields),values:{}},value=fixture(resource);
 value.editor.input({dataset:{resourceValue:'counter'},value:'000155'});assert.doesNotThrow(()=>value.editor.validate());assert.equal(resource.values.counter,'000155');assert.ok(value.editor.view().includes('Base 6 integer'));
 value.editor.input({dataset:{resourceValue:'counter'},value:'6'});assert.throws(()=>value.editor.validate(),/counter/);assert.equal(resource.values.counter,'6');
 input('numericRepresentation','rational');assert.deepEqual(f.numeric,{version:1,representation:'rational',radix:10});assert.equal(resource.fieldSchema[0].numeric.radix,6);
});
