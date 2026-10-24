import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {correlationControls,readCorrelationControls,correlationStatusText,correlationPolicyDescription} from '../src/web/dataset-correlation-ui.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label>'+label+input+'</label>';
function controls(metric){
 const html=correlationControls(metric,{esc,field}),tree=parseFragment(html),cache=new WeakMap(),all=node=>(node.childNodes??[]).flatMap(child=>[child,...all(child)]),attrs=node=>Object.fromEntries((node.attrs??[]).map(item=>[item.name,item.value]));
 const wrap=node=>{if(cache.has(node))return cache.get(node);const a=attrs(node),value={value:node.nodeName==='select'?attrs(all(node).find(item=>item.nodeName==='option'&&Object.hasOwn(attrs(item),'selected'))??all(node).find(item=>item.nodeName==='option')).value:a.value,dataset:Object.fromEntries(Object.entries(a).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value])),querySelectorAll(selector){const key=selector.slice(1,-1);return all(node).filter(item=>Object.hasOwn(attrs(item),key)).map(wrap);},querySelector(selector){return this.querySelectorAll(selector)[0]??null;}};cache.set(node,value);return value;};
 const root=wrap(tree),area=root.querySelector('[data-aggregate-correlation]');return {html,root,area,input:key=>area.querySelectorAll('[data-calculation-policy]').find(node=>node.dataset.calculationPolicy===key)};
}
test('Pearson controls expose the selected method and an explicit structured precision policy',()=>{
 const original={operation:'correlation'},view=controls(original),read=readCorrelationControls(view.root,{validate:true});assert.deepEqual(read,{method:'pearson-centered-pairs-v1',calculationPolicy:defaultStructuredCalculationPolicy()});assert.deepEqual(original,{operation:'correlation'});assert.match(view.html,/Pearson correlation from exact centered complete pairs/);assert.match(view.html,/At least two complete pairs/);assert.match(view.html,/nonzero spread in both coordinates/);assert.match(view.html,/Display digits affect presentation only/);
});
test('correlation policy edits preserve the pinned library and independent owned precision choices',()=>{
 const policy=defaultStructuredCalculationPolicy();policy.library.version='15.1.9';const original=structuredClone(policy),view=controls({operation:'correlation',calculationPolicy:policy});view.input('workingDigits').value='96';view.input('displayDigits').value='5';view.input('rounding').value='ceiling';view.input('maxOperations').value='8000';const read=readCorrelationControls(view.root,{validate:true});assert.equal(read.calculationPolicy.workingDigits,96);assert.equal(read.calculationPolicy.displayDigits,5);assert.equal(read.calculationPolicy.rounding,'ceiling');assert.equal(read.calculationPolicy.resources.maxOperations,8000);assert.deepEqual(read.calculationPolicy.library,original.library);assert.deepEqual(policy,original);assert.match(correlationPolicyDescription(read.calculationPolicy),/96 working digits.*5 display digits.*15.1.9/);
});
test('incomplete precision edits survive local refusal without being replaced by defaults',()=>{
 const view=controls({operation:'correlation'});view.input('workingDigits').value='';assert.equal(readCorrelationControls(view.root).calculationPolicy.workingDigits,null);assert.throws(()=>readCorrelationControls(view.root,{validate:true}),/valid saved engine 4/);assert.equal(view.input('workingDigits').value,'');view.input('workingDigits').value='80';assert.equal(readCorrelationControls(view.root,{validate:true}).calculationPolicy.workingDigits,80);
});
test('correlation unavailable statuses distinguish pair count and both spreads without substituting zero',()=>{
 for(const status of ['no-pairs','insufficient-pairs','zero-x-spread','zero-y-spread','zero-both-spread'])assert.match(correlationStatusText(status),/correlation is unavailable/);assert.match(correlationStatusText('zero-x-spread'),/variation in X/);assert.match(correlationStatusText('zero-y-spread'),/variation in Y/);assert.match(correlationStatusText('zero-both-spread'),/either coordinate/);assert.match(correlationStatusText('ready'),/defined/);assert.throws(()=>correlationStatusText('zero'),/Unsupported retained/);assert.match(controls({operation:'correlation'}).html,/Unavailable correlation is never replaced by zero/);
});

import {cellComputationView,computationPolicyView,scalarFormatView} from '../src/web/measurement-computation-ui.js';
import {computationLabel,CellComputationError} from '../src/web/measurement-computation.js';
import {safeError} from '../src/errors.js';
import {aggregationPairContextText} from '../src/web/dataset-aggregation-context.js';
test('mixed cell presentation distinguishes exact, approximate and unavailable values without inferring from the column',()=>{
 const policy=defaultStructuredCalculationPolicy(),column={representation:'rational',radix:10,unit:'',computation:{version:2,kind:'per-cell'}},approximate={version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy},row={cells:['1/1','0/1',''],valueKinds:['string','string','absent'],cellComputations:[null,approximate,null]};
 assert.match(computationLabel(column),/separately/);assert.match(cellComputationView(column,row,0,{esc}),/data-cell-computation="exact"/);assert.doesNotMatch(cellComputationView(column,row,0,{esc}),/approximate/i);assert.match(cellComputationView(column,row,1,{esc}),/Approximate Pearson/);assert.equal(cellComputationView(column,row,2,{esc}),'');assert.throws(()=>cellComputationView(column,{cells:['1/1']},0,{esc}),CellComputationError);assert.equal(cellComputationView({},row,0,{esc}),'');assert.match(computationPolicyView(approximate,{esc}),/working digits.*display digits/);assert.match(scalarFormatView(column,{esc}),/Rational.*base 10/i);
 const failure=safeError(new CellComputationError());assert.equal(failure.code,'DATASET_CELL_COMPUTATION');assert.match(failure.message,/current calculation graph/);assert.deepEqual(failure.details,[]);
});
test('public Pearson context preserves saved precision and rejects mismatched methods or missing policies',()=>{
 const metric={operation:'correlation',method:'pearson-centered-pairs-v1',pairing:'complete-rows-v1',calculationPolicy:defaultStructuredCalculationPolicy()};metric.calculationPolicy.workingDigits=96;metric.calculationPolicy.displayDigits=5;const text=aggregationPairContextText(metric);assert.match(text,/Pearson.*complete row pairs/);assert.match(text,/96 working digits.*5 display digits/);for(const invalid of [{...metric,calculationPolicy:undefined},{...metric,method:'centered-pairs-v1'},{...metric,normalization:'sample'}])assert.throws(()=>aggregationPairContextText(invalid),/Unsupported/);assert.doesNotMatch(text,/significance|confidence|causality/);
});

test('graph preview format labels accept the existing representation-only projection without inventing a base',()=>{
 const html=scalarFormatView({representation:'rational',computation:{version:2,kind:'per-cell'}},{esc});assert.match(html,/Rational/i);assert.doesNotMatch(html,/base|undefined|unit:/);assert.equal(scalarFormatView({representation:'domain'},{esc}),'');
});
