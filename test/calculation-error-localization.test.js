import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {calculateDetailed,convertBase,spreadsheet} from '../src/tools/math.js';
import {defaultCalculationPolicy,defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {calculationErrorMessage} from '../src/web/tools/calculation-error-messages.js';
import {calculationErrorText} from '../src/web/tools/calculation-policy-ui.js';

const fetcher=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
const E=()=>({engine:3,policy:defaultCalculationPolicy()});
const capture=operation=>{try{operation();assert.fail('Expected a calculation diagnostic');}catch(error){if(error.code==='ERR_ASSERTION')throw error;return {error:error.message,...(error.code?{errorCode:error.code}:{})};}};

test('actual arithmetic, base and sheet errors translate without changing source tokens, raw diagnostics or computed results',async context=>{
 context.after(()=>activateLanguage('en'));
 const failures=[
  [capture(()=>calculateDetailed('1/0',E())),'mathErrorZero'],
  [capture(()=>calculateDetailed('unknown_value',E())),'mathErrorUnknownValue',{name:'unknown_value'}],
  [capture(()=>calculateDetailed('derivative(1)',E())),'mathErrorFunction',{name:'derivative'}],
  [capture(()=>calculateDetailed('1 m + 2 s',E())),'mathErrorUnits'],
  [capture(()=>calculateDetailed('sin(1 m)',E())),'mathErrorAngle'],
  [capture(()=>calculateDetailed('round(sin(1),0.5)',E())),'mathErrorRounding'],
  [capture(()=>convertBase('6',6,10,E())),'mathErrorDigitBase',{digit:'6',base:'6'}],
  [spreadsheet([['=A1']],E())[0][0],'mathErrorCircular',{cell:'A1'}],
  [spreadsheet([['=B1']],E())[0][0],'mathErrorOutsideSheet',{cell:'B1'}],
  [spreadsheet([["'Authored text",'=A1']],E())[0][1],'mathErrorCellNumeric',{cell:'A1'}]
 ];
 const originals=structuredClone(failures),cells=[['0.1','0.2','=A1+B1']],before=structuredClone(cells);
 const exact=calculateDetailed('0.1+0.2',E()),sheet=spreadsheet(cells,E()),base=convertBase('0.2',6,10,E());
 const policy=defaultStructuredCalculationPolicy(),structured=calculateDetailed('[1,2]+[3,4]',{engine:4,policy});
 for(const locale of ['en','ca','es','nb','nn']){
  await prepareLanguage(locale,{fetcher});activateLanguage(locale);
  for(const [failure,key,parameters]of failures)assert.equal(calculationErrorText(failure),t('calculator',key,parameters));
  assert.deepEqual(failures,originals);
  assert.deepEqual(calculateDetailed('0.1+0.2',E()),exact);assert.deepEqual(spreadsheet(cells,E()),sheet);assert.equal(convertBase('0.2',6,10,E()),base);
  assert.deepEqual(calculateDetailed('[1,2]+[3,4]',{engine:4,policy}),structured);assert.deepEqual(cells,before);
 }
});

test('syntax positions and argument details retain technical identifiers in every display language',async context=>{
 context.after(()=>activateLanguage('en'));
 const syntax=capture(()=>calculateDetailed('1 +',E()));
 assert.equal(calculationErrorMessage(syntax).key,'mathErrorSyntaxEnd');
 const few=capture(()=>calculateDetailed('sin()',E()));
 assert.equal(calculationErrorMessage(few).key,'mathErrorTooFewArguments');
 const many=capture(()=>calculateDetailed('sin(1,2)',E()));
 assert.equal(calculationErrorMessage(many).key,'mathErrorTooManyArguments');
 const policy=capture(()=>calculateDetailed('sqrt(2)',{engine:3,policy:{...defaultCalculationPolicy(),workingDigits:0}}));
 for(const locale of ['en','ca','es','nb','nn']){
  await prepareLanguage(locale,{fetcher});activateLanguage(locale);
  const position=calculationErrorMessage(syntax).character;
  assert.equal(calculationErrorText(syntax),t('calculator','mathErrorAtCharacter',{message:t('calculator','mathErrorSyntaxEnd'),character:position}));
  for(const value of [few,many])assert.ok(calculationErrorText(value).includes('sin'));
  assert.equal(calculationErrorText(policy),t('calculator','invalidPolicy'));
  const unknown={error:'Unrecognized library diagnostic: keep <unit> and 105₆',errorCode:'FUTURE_CODE'};
  assert.equal(calculationErrorMessage(unknown),null);assert.equal(calculationErrorText(unknown),unknown.error);
  assert.equal(calculationErrorText({}), '');
 }
});
