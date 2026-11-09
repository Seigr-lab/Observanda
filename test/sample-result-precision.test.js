import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleInterval} from '../src/web/sample-result-numerics.js';
import {applySampleAnalysisCommand, validateLab, blank} from '../src/sample-analysis-model.js';

const decimal = spelling => ({spelling, representation:'decimal', radix:10, precision:'exact'});
const result = (value, lower = null, upper = null) => ({
  numericVersion:2, kind:'numeric', method:'Conductance v1', analyte:'Conductance', unit:'S', notes:'', value, lower, upper
});
const sample = {id:randomUUID(),code:'S-001',material:'Reference resistor',source:'',collectedOn:'2026-01-01',receivedOn:'2026-01-01'};
const create = result => applySampleAnalysisCommand({action:'create-analysis',etag:'new',analysis:{sampleId:sample.id,code:'R-001',result}},{sourceSample:sample}).record;
const command = (record,action,details={}) => applySampleAnalysisCommand({action,etag:'new',id:record.id,...details},{sourceSample:sample,existing:record}).record;

test('sample interval is inclusive and compares declared values across numeral systems', () => {
  const v = decimal('0.10000000000000000001'), low = decimal('0.10000000000000000002');
  const cases = [
    [result(v,low), 'below'], [result(low,v,low),'within'], [result(v,v,low),'within'],
    [result(decimal('-0.020'),decimal('-0.10'),decimal('-0.03')), 'above'],
    [result({...decimal('0.3'), representation:'radix-fraction',radix:6}, {...decimal('1/2'),representation:'rational'}), 'within'],
    [result({...low,precision:'approximate'}, v), 'within'], [result(v), 'noInterval'],
  ];
  for(const [r,flag] of cases) {
    const record = create(r);
    assert.deepEqual(record.result,r);
    assert.equal(sampleInterval(record.result).flag,flag);
  }
  for(const invalid of [result(decimal('1,5')),result(decimal('')),result(decimal('2'),low,v),result({...v,radix:6}),result(decimal('1e100000000')),result(0.1,v)]) {
    assert.throws(()=>create(invalid),{code:'LAB_INVALID'});
  }
});

test('review covers exact spelling, representation, and original historical binary values', () => {
  const legacy = result(0.1,null,1); delete legacy.numericVersion;
  assert.throws(()=>create(legacy),{code:'LAB_INVALID'});
  const before = {...create(result(decimal('0.1'))),result:legacy};
  validateLab({...blank(),samples:[sample],analyses:[before]});
  assert.equal(command(before,'save-result',{result:{...legacy,notes:'Preserved binary reading'}}).result.value,0.1);
  assert.throws(()=>command(before,'save-result',{result:{...legacy,value:0.2}}),{code:'LAB_INVALID'});
  const amended = command(before,'save-result',{result:result(before.result.value,null,decimal('0.10000000000000000001'))});
  assert.throws(()=>command(amended,'save-result',{result:legacy}),{code:'LAB_INVALID'});
  assert.equal(sampleInterval(amended.result).flag,'above');
  assert.equal(typeof amended.result.value,'number');
  const submitted = command(amended,'submit');
  const approved = command(submitted,'review',{reviewer:'Operator',decision:'approve',comment:'Checked limits',checked:true});
  const lab = {...blank(),samples:[sample],analyses:[approved]};
  validateLab(lab);
  for(const change of [r=>r.upper.spelling+='0', r=>r.upper.precision='approximate', r=>r.method+=' revised']) {
    const modified=structuredClone(lab);change(modified.analyses[0].result);
    assert.throws(()=>validateLab(modified),{code:'LAB_INVALID'});
  }
});
