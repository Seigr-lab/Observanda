import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';
import {readBOMTable,mapBOMTable,suggestedBOMMapping} from '../src/web/modules/bom-import-model.js';
import {moduleErrorMessage,moduleErrorDetail,bomImportColumns} from '../src/web/modules/module-validation-presentation.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {readBOMSource,verifyBOMSource} from '../src/bom-import.js';
import {safeError} from '../src/errors.js';

const catalogue=locale=>readFile(new URL('../src/web/locales/'+locale+'/bomImport.json',import.meta.url),'utf8').then(JSON.parse);
const load=async locale=>{await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);};
function caught(operation){try{operation();assert.fail('Expected invalid input');}catch(error){assert.ok(error.diagnostic,'Validation must retain stable diagnostic metadata');return error;}}

test('BOM diagnostics change language while references, flags, exact quantities and column identities stay invariant',async context=>{
 context.after(()=>activateLanguage('en'));const english=await catalogue('en');
 const source='Reference,Value,Qty,DNP,Exclude from BOM,,Columna 6\nR1-R2,=CUSTOM(6),9007199254740993,yes,,Authored <text>,Other\nX1,Excluded,1,no,yes,Keep,Other';
 const table=readBOMTable(source),mapping=suggestedBOMMapping(table),baseline=mapBOMTable(table,mapping),original=structuredClone(table);
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);validateCatalogue(messages,english);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());await load(locale);
  assert.deepEqual(readBOMTable(source,'auto',{translate:t}),table);assert.deepEqual(mapBOMTable(table,mapping,{translate:t}),baseline);
  const shown=bomImportColumns(table);assert.equal(shown[5].index,5);assert.equal(shown[5].label,t('bomImport','column',{number:6}));
  assert.ok(shown[6].label.startsWith('Columna 6'));assert.equal(new Set(shown.map(column=>column.label)).size,shown.length);assert.deepEqual(table,original);
  const invalid=readBOMTable('Reference,Value,Qty,DNP\nR1,A,1,sí'),invalidMapping=suggestedBOMMapping(invalid);
  const localized=caught(()=>mapBOMTable(invalid,invalidMapping,{translate:t}));assert.equal(localized.message,t('bomImport','flagDnp',{row:2,value:'sí'}));
  assert.deepEqual(localized.diagnostic,{namespace:'bomImport',key:'flagDnp',parameters:{row:2,value:'sí'}});
  assert.equal(caught(()=>mapBOMTable(invalid,invalidMapping)).message,'Line 2: DNP value "sí" is ambiguous. Use blank/no/false/0 or yes/true/1.');
  const fieldTable=readBOMTable('Value,Qty,MPN\nA,1,'+'X'.repeat(241)),field=caught(()=>mapBOMTable(fieldTable,suggestedBOMMapping(fieldTable),{translate:t}));
  assert.equal(field.message,t('bomImport','field',{row:2,field:messages.fieldPartNumber,max:240}));assert.equal(field.diagnostic.parameters.field,'partNumber');
  const malformed=caught(()=>readBOMTable('Value,Qty\nA',',',{translate:t}));assert.equal(malformed.diagnostic.namespace,'figureDiagnostics');assert.equal(malformed.message,t('figureDiagnostics','tableWidth',{line:2,found:1,expected:2}));
 }
 assert.equal(moduleErrorDetail({field:'Custom <diagnostic>',diagnostic:{namespace:'unknown',key:'message'}}),'Custom <diagnostic>');
 assert.equal(moduleErrorDetail({field:'Incomplete diagnostic',diagnostic:{namespace:'bomImport',key:'field'}}),'Incomplete diagnostic');
 assert.equal(moduleErrorMessage({code:'MODULE_INVALID',message:'A specific authored conflict'}),'A specific authored conflict');
});

test('server BOM source diagnostics survive safe error serialization and localize in module presentation',async context=>{
 context.after(()=>activateLanguage('en'));
 const artifact={kind:'artifact',id:'12345678-1234-4234-8234-123456789abc',revision:'a'.repeat(64)};let bytes=Buffer.from('Value,Qty\nA'),name='Authored <name>.csv';
 context.mock.method(ResearchMaterials.prototype,'read',async()=>({content:{size:bytes.length,name,sha256:'b'.repeat(64)}}));
 context.mock.method(ResearchMaterials.prototype,'artifact',async()=>({content:{size:bytes.length,async *read(){yield bytes;}}}));
 const receive=async operation=>{try{await operation();assert.fail('Expected invalid source');}catch(error){assert.equal(error.code,'MODULE_INVALID');return JSON.parse(JSON.stringify(safeError(error)));}};
 const width=await receive(()=>readBOMSource({}, {artifact}));assert.equal(width.details[0].field,'Line 2: found 1 columns; expected 2. Check the separator and quoted fields.');
 const missing=await receive(()=>readBOMSource({}, {artifact:null}));assert.equal(missing.details[0].diagnostic.key,'sourceFile');
 bytes=Buffer.from([0xff,0xfe]);const encoding=await receive(()=>readBOMSource({}, {artifact}));assert.equal(encoding.details[0].diagnostic.key,'sourceEncoding');
 bytes=Buffer.from('Value,Qty\nA,1');const valid=await readBOMSource({}, {artifact}),source={version:1,artifact,sha256:valid.sha256,size:valid.size,name:'Changed name.csv',delimiter:valid.table.delimiter,mapping:suggestedBOMMapping(valid.table),referenceSeparator:','};
 const changed=await receive(()=>verifyBOMSource({},source));assert.equal(changed.details[0].diagnostic.key,'sourceChanged');
 for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);assert.equal(moduleErrorMessage(width),t('errors','MODULE_INVALID'));
  assert.equal(moduleErrorDetail(width.details[0]),t('figureDiagnostics','tableWidth',{line:2,found:1,expected:2}));
  for(const error of [missing,encoding,changed])assert.equal(moduleErrorDetail(error.details[0]),t('bomImport',error.details[0].diagnostic.key));
 }
});
