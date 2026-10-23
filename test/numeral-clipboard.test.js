import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {CONSTANT_REPRESENTATIONS} from '../src/web/calculation-operands.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NUMERAL_CLIPBOARD_PREFIX,encodeNumeralClipboard,decodeNumeralClipboard,validNumeralClipboardValue} from '../src/web/numeral-clipboard.js';
import {exactRational} from '../src/web/measurement-rational.js';
const value=(spelling,representation='decimal',radix=10)=>({spelling,context:{version:1,representation,radix}});
const marked=payload=>NUMERAL_CLIPBOARD_PREFIX+JSON.stringify(payload);
const invalid={code:'NUMERAL_CLIPBOARD_INVALID'};

test('typed clipboard preserves original spelling and exact scalar identity without normalization',()=>{
 for(const source of [value('0010','radix',6),value('-15.30','radix-fraction',6),value('+Ff','radix',16),value('-001/3','rational'),value('+01.2500e+2'),value('-'+'9'.repeat(96),'integer')]){
  const result=decodeNumeralClipboard(encodeNumeralClipboard(source));assert.deepEqual(result,{kind:'typed',...source});
  assert.deepEqual(exactRational(result.spelling,result.context.representation,result.context.radix),exactRational(source.spelling,source.context.representation,source.context.radix));
 }
 for(let radix=2;radix<=36;radix++)for(const sign of ['','-','+']){const source=value(sign+'00'+(radix-1).toString(36)+'.0','radix-fraction',radix);assert.deepEqual(decodeNumeralClipboard(encodeNumeralClipboard(source)),{kind:'typed',...source});}
});

test('equivalent numbers, different bases and deliberate symbols retain separate contexts',()=>{
 const sources=[value('10','radix',6),value('010','radix',6),value('10'),value('10','text'),value('010','text')];
 const decoded=sources.map(v=>decodeNumeralClipboard(encodeNumeralClipboard(v)));
 assert.deepEqual(decoded,sources.map(v=>({kind:'typed',...v})));assert.equal(new Set(sources.map(encodeNumeralClipboard)).size,5);
 assert.deepEqual(exactRational(decoded[0].spelling,'radix',6),exactRational(decoded[1].spelling,'radix',6));
 assert.notDeepEqual(exactRational(decoded[0].spelling,'radix',6),exactRational(decoded[2].spelling));
 const symbol=value('  alpha\n\u{1f41d}\t010  ','text');assert.deepEqual(decodeNumeralClipboard(encodeNumeralClipboard(symbol)),{kind:'typed',...symbol});
});

test('ordinary text is returned unchanged with no inferred numeric interpretation',()=>{
 for(const spelling of ['10','010','0.1','1/6','-9007199254740993','6#10','  +Ff\n','',JSON.stringify({version:1,spelling:'10',context:{representation:'radix',radix:6}})])assert.deepEqual(decodeNumeralClipboard(spelling),{kind:'plain',spelling});
});

test('recognized malformed or future typed payloads refuse rather than falling back to plain text',()=>{
 const good={format:'observanda-value',version:1,...value('10','radix',6)};
 for(const payload of [{...good,version:2},{...good,format:'other'},{...good,context:{...good.context,version:2}},{...good,context:{...good.context,representation:'future'}},{...good,context:{...good.context,radix:'6'}},{...good,context:{...good.context,round:2}},{...good,provenance:{}},{...good,spelling:10},[good],null])assert.throws(()=>decodeNumeralClipboard(marked(payload)),invalid);
 for(const source of [NUMERAL_CLIPBOARD_PREFIX,NUMERAL_CLIPBOARD_PREFIX+'{',NUMERAL_CLIPBOARD_PREFIX+JSON.stringify(good)+'extra',null,{}])assert.throws(()=>decodeNumeralClipboard(source),invalid);
 assert.deepEqual(decodeNumeralClipboard(' \n'+marked(good)+'\r\n'),{kind:'typed',...value('10','radix',6)});
});

test('typed admission uses existing complete spelling and context validation',()=>{
 for(const source of [value('6','radix',6),value('1.2','integer'),value('1/0','rational'),value('1/6','decimal'),value('NaN'),value('10','decimal',6),value('10','radix',1),value('10','radix',37),value('x','unsupported'),value('10','domain'),value('a\u0000b','text')]){
  assert.equal(validNumeralClipboardValue(source),false);assert.throws(()=>encodeNumeralClipboard(source),invalid);
  assert.throws(()=>decodeNumeralClipboard(marked({format:'observanda-value',version:1,...source})),invalid);
 }
});

test('clipboard copies are detached and cannot carry undeclared evidence or unit metadata',()=>{
 const source=value('10','radix',6),copy=decodeNumeralClipboard(encodeNumeralClipboard(source));copy.context.radix=8;assert.equal(source.context.radix,6);
 for(const extra of [{unit:'s'},{quantity:{origin:'measured'}},{source:{revision:'not-authorized'}}])assert.throws(()=>encodeNumeralClipboard({...source,...extra}),invalid);
});
test('recipe constant choices contain only explicit text and supported scalar interpretations',()=>{assert.deepEqual(CONSTANT_REPRESENTATIONS,['text','decimal','integer','radix','radix-fraction','rational']);});

const policy=(resources={})=>{const value=defaultDatasetResourcePolicy();return {...value,resources:{...value.resources,...resources}};};
test('policy clipboard preserves complete long senary and rational spellings in an explicit ephemeral envelope',()=>{
 const resourcePolicy=policy({maxScalarCharacters:10000,maxOperations:100000}),sources=[value('-'+'0'.repeat(9000)+'15.30','radix-fraction',6),value('+'+'0'.repeat(9000)+'1/3','rational')];
 for(const source of sources){const encoded=encodeNumeralClipboard(source,{resourcePolicy}),payload=JSON.parse(encoded.slice(NUMERAL_CLIPBOARD_PREFIX.length));assert.equal(payload.version,2);assert.equal(payload.context.version,1);const decoded=decodeNumeralClipboard(encoded,{resourcePolicy});assert.deepEqual(decoded,{kind:'typed',...source,resourcePolicy});decoded.resourcePolicy.resources.maxBits=64;assert.equal(resourcePolicy.resources.maxBits,65536);}
});
test('clipboard destination policy owns acceptance without adopting an incoming larger allowance',()=>{
 const sender=policy({maxScalarCharacters:10000,maxOperations:100000}),destination=policy(),before=structuredClone(destination),source=value('0'.repeat(9000)+'15','radix',6),encoded=encodeNumeralClipboard(source,{resourcePolicy:sender});
 assert.throws(()=>decodeNumeralClipboard(encoded,{resourcePolicy:destination}),{code:'DATASET_CALCULATION_RESOURCE'});assert.deepEqual(destination,before);assert.throws(()=>decodeNumeralClipboard(encoded),invalid);
 for(const [spelling,limits] of [['1e100',{maxExponent:20}],['18446744073709551616',{maxBits:64}],['123456789',{maxOperations:1}]]){const encoded=encodeNumeralClipboard(value(spelling),{resourcePolicy:sender});assert.throws(()=>decodeNumeralClipboard(encoded,{resourcePolicy:policy(limits)}),{code:'DATASET_CALCULATION_RESOURCE'});}
 const ordinary=encodeNumeralClipboard(value('0015','radix',6));assert.deepEqual(decodeNumeralClipboard(ordinary,{resourcePolicy:sender}),{kind:'typed',...value('0015','radix',6)});assert.deepEqual(decodeNumeralClipboard('0'.repeat(9000)+'1',{resourcePolicy:destination}),{kind:'plain',spelling:'0'.repeat(9000)+'1'});
});
test('policy clipboard rejects unknown envelopes, false sender declarations and invalid complete suffixes',()=>{
 const resourcePolicy=policy({maxScalarCharacters:10000,maxOperations:100000}),source=value('0'.repeat(9000)+'15','radix',6),good={format:'observanda-value',version:2,...source,resourcePolicy};
 for(const payload of [{...good,version:3},{...good,resourcePolicy:{...resourcePolicy,version:2}},{...good,context:{...source.context,version:2}},{...good,extra:true},{...good,spelling:source.spelling+'6'}])assert.throws(()=>decodeNumeralClipboard(marked(payload),{resourcePolicy}),invalid);
 assert.throws(()=>decodeNumeralClipboard(marked({...good,resourcePolicy:policy()}),{resourcePolicy}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>decodeNumeralClipboard(marked({format:'observanda-value',version:1,...source}),{resourcePolicy}),invalid,'format 1 never gains a larger unstated source policy');
 const malformed=value('0'.repeat(9000)+'1/0','rational');assert.equal(validNumeralClipboardValue(malformed,{resourcePolicy}),false);assert.throws(()=>encodeNumeralClipboard(malformed,{resourcePolicy}),invalid);
});
