import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formula,reaction} from '../src/web/tools/stoichiometry.js';
import {chemicalPreview} from '../src/tools/chemistry.js';
import {chemistryTranslator} from '../src/tools/chemistry-localization.js';
const locales=['en','ca','es','nb','nn'];
const component=(role,value,coefficient,amount,unit='mol',volume='')=>({role,formula:value,coefficient,molarMass:'',amount,unit,volume});
const rows=[component('reactant','H2','2','4'),component('reactant','O2','1','1'),component('product','H2O','2','18.015','g')];
const cdxml='<CDXML><page><fragment><n id="1" Element="6" p="0 0"/><n id="2" Element="8" p="1 0"/><b B="1" E="2" Order="1"/></fragment><arrow/></page></CDXML>';
const message=(translate,key,values)=>translate('chemistryDiagnostics',key,values);
// OpenChemLib allocates a fresh SVG id per depiction; geometry must stay exact.
const depiction=value=>({...value,svg:value.svg.replace(/mol\d+/g,'mol')});

test('formula and reaction diagnostics translate explicitly without changing calculations or source values',()=>{
 const before=structuredClone(rows),expected=reaction(rows);
 for(const locale of locales){
  const translate=chemistryTranslator(locale),options={translate},text=(key,values)=>message(translate,key,values);
  assert.deepEqual(formula('CuSO4·5H2O',options),formula('CuSO4·5H2O'));
  assert.deepEqual(reaction(rows,options),expected);assert.deepEqual(rows,before);
  for(const [source,key,values]of [['','formulaRequired'],['H100001','formulaCount'],['('.repeat(14)+'H'+')'.repeat(14),'formulaDepth'],['(H','formulaUnclosed'],['H0','formulaNear',{value:'0'}],['()','formulaEmpty'],['100001H','formulaInvalid'],['Xx','formulaAtomicWeight',{element:'Xx'}],['100000H100000','formulaSize']])assert.throws(()=>formula(source,options),{message:text(key,values)});
  for(const [field,key]of [['coefficient','coefficient'],['molarMass','molarMass'],['amount','amount'],['volume','solutionVolume']]){
   const changed=structuredClone(rows);changed[0][field]='invalid';
   assert.throws(()=>reaction(changed,options),{message:text('positiveNumber',{label:text(key)})});
   changed[0][field]=field==='amount'?'1e999':'0';assert.throws(()=>reaction(changed,options),{message:text('checkNumber',{label:text(key)})});
  }
  assert.throws(()=>reaction(Array(41),options),{message:text('reactionLimit')});
  assert.throws(()=>reaction([],options),{message:text('reactionSides')});
  const invalidUnit=structuredClone(rows);invalidUnit[0].unit='unknown';assert.throws(()=>reaction(invalidUnit,options),{message:text('amountUnit')});
 }
 assert.throws(()=>formula(''),{message:'Enter a molecular formula.'});
 assert.throws(()=>reaction([]),{message:'Add reactants and products.'});
});

test('chemical previews translate generated names, known failures and annotations while preserving authored names and molecular output',()=>{
 const original=chemicalPreview(cdxml,'cdxml').structures[0];
 for(const locale of locales){
  const translate=chemistryTranslator(locale),options={translate},text=(key,values)=>message(translate,key,values);
  const result=chemicalPreview(cdxml,'cdxml',options),structure=result.structures[0];
  assert.equal(structure.name,text('fragmentName',{number:1}));assert.deepEqual(depiction({...structure,name:original.name}),depiction(original));
  assert.deepEqual(result.notes,[text('drawingAnnotations')]);
  const named=chemicalPreview('CCO User structure <keep>','smiles',options).structures[0];assert.equal(named.name,'User structure <keep>');
  assert.equal(chemicalPreview('CCO','smiles',options).structures[0].name,text('structureName',{number:1}));
  assert.equal(chemicalPreview(cdxml.replace('Element="6"','NodeType="Nickname"'),'cdxml',options).structures[0].error,text('originalRetained',{message:text('specialAtom')}));
  assert.throws(()=>chemicalPreview('','smiles',options),{message:text('chemicalFile')});
  assert.throws(()=>chemicalPreview('CCO','unknown',options),{message:text('chemicalFormat')});
  assert.throws(()=>chemicalPreview('<Other/>','cdxml',options),{message:text('cdxmlInvalid')});
  assert.throws(()=>chemicalPreview('<!DOCTYPE CDXML [<!ENTITY x "bad">]><CDXML/>','cdxml',options),{message:text('xmlEntities')});
 }
 assert.equal(chemicalPreview('CCO','smiles').structures[0].name,'Structure 1');
 assert.equal(chemicalPreview(cdxml,'cdxml').structures[0].name,'Fragment 1');
});

test('translated previews use localized library-failure explanations and preserve raw diagnostics for pure callers',()=>{
 const invalidSmiles='C)',malformed='<CDXML><fragment>';
 const original=chemicalPreview(invalidSmiles,'smiles');
 assert.match(original.structures[0].error,/Could not interpret this SMILES structure:/);
 for(const locale of locales){
  const translate=chemistryTranslator(locale),text=(key,values)=>message(translate,key,values);
  assert.deepEqual(chemicalPreview(invalidSmiles,'smiles',{translate}).structures,[{name:text('lineName',{number:1}),error:text('smilesInvalid',{message:text('structureInterpretation')})}]);
  assert.throws(()=>chemicalPreview(malformed,'cdxml',{translate}),error=>error.message===text('cdxmlSyntax')&&error.cause instanceof Error);
 }
 assert.deepEqual(chemicalPreview(invalidSmiles,'smiles'),original);
});

test('worker chemical requests select their own locale and leave default callers unchanged',async context=>{
 const previous=globalThis.self;let response;globalThis.self={postMessage:value=>{response=value;}};context.after(()=>{globalThis.self=previous;});
 await import('../src/tools/worker.js');
 for(const locale of [...locales,'ca-ES','../../private']){
  const translate=chemistryTranslator(locale);
  self.onmessage({data:{kind:'chemical',language:locale,value:{format:'smiles',source:'CCO'}}});
  assert.equal(response.result.structures[0].name,message(translate,'structureName',{number:1}));
  self.onmessage({data:{kind:'chemical',language:locale,value:{format:'smiles',source:''}}});
  assert.deepEqual(response,{error:message(translate,'chemicalFile')});
 }
 self.onmessage({data:{kind:'chemical',value:{format:'smiles',source:'C)'}}});assert.deepEqual(response,{result:chemicalPreview('C)','smiles')});
});
