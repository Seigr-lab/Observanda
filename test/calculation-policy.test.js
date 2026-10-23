import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,calculateDetailed,calculationRuntime,convertBase,spreadsheet} from '../src/tools/math.js';
import {defaultCalculationPolicy,validCalculationPolicy,checkpointHasCalculationPolicy,calculationWorkerTimeout} from '../src/web/tools/calculation-policy.js';
import {validateTool} from '../src/modules/tools.js';
const options=(changes={})=>({engine:3,policy:{...defaultCalculationPolicy(),...changes}});
test('saved precision policies isolate approximate arithmetic, display rounding and exact expressions',()=>{
 const historical=calculateDetailed('sqrt(2)',{engine:2}),down=options({displayDigits:5,rounding:'floor'}),up=options({displayDigits:5,rounding:'ceiling'});
 assert.equal(calculate('sqrt(2)',down),'1.4142');assert.equal(calculate('sqrt(2)',up),'1.4143');assert.equal(calculate('-sqrt(2)',down),'-1.4143');
 assert.equal(calculate('-sqrt(2)',up),'-1.4142');assert.deepEqual(calculateDetailed('sqrt(2)',{engine:2}),historical);
 const high=options({workingDigits:100,displayDigits:90});assert.ok(calculate('sqrt(2)',high).length>85);
 assert.equal(calculate('1/3',down),'1/3');assert.equal(calculate('1e100+1-1e100',down),'1');assert.equal(calculate('round(-1.5)',options({rounding:'half-even'})),'-2');
 const answer=calculateDetailed('sqrt(2)',up);assert.deepEqual(answer.approximation,{engine:3,...up.policy});assert.equal(calculate('sqrt(2)',down),'1.4142');
 assert.throws(()=>calculate('sqrt(-1)',up),/scalar|Complex/);assert.throws(()=>calculate('[1,2]',up),/Only numbers/);
});
test('spreadsheet dependencies retain working values independently of display policy and share a refusing budget',()=>{
 const value=spreadsheet([['=sqrt(2)','=A1*A1','=B1-2'],['=1/3','=A2*3','']],options({displayDigits:3}));
 assert.equal(value[0][0].value,'1.41');assert.equal(value[0][2].value,'0');assert.equal(value[1][1].value,'1');
 const low=defaultCalculationPolicy();low.resources.maxBits=64;
 assert.throws(()=>calculate('1e100+1-1e100',{engine:3,policy:low}),/resource budget/);
 assert.throws(()=>convertBase('1000000000000000000000000000000',10,6,{engine:3,policy:low}),/resource budget/);
 low.resources.maxBits=65536;low.resources.maxOperations=1;
 const exhausted=spreadsheet([['=1+1','=1/3']],{engine:3,policy:low});assert.ok(exhausted[0].every(item=>/resource budget/.test(item.error)));assert.ok(exhausted[0].every(item=>!item.approximation));
 const shared=options({resources:{...defaultCalculationPolicy().resources,maxOperations:20}}),worksheet=calculationRuntime(shared);
 assert.ok(calculateDetailed('sin(1)',{...shared,runtime:worksheet}).approximation);
 assert.throws(()=>{for(let i=0;i<10;i++)calculateDetailed('sin(1)',{...shared,runtime:worksheet});},/resource budget/);
 assert.throws(()=>calculate('sin(1)+cos(2)+tan(3)',options({resources:{...defaultCalculationPolicy().resources,maxOperations:10}})),/resource budget/);
 const normal=options(),runtime=calculationRuntime(normal);runtime.budget.deadline=0;
 assert.throws(()=>calculate('sqrt(2)',{...normal,runtime}),/resource budget/);
 assert.equal(convertBase('0.2',6,10,options()),'1/3');
});
test('saved contracts reject silent version changes while unavailable pinned libraries stay inspectable',()=>{
 const data={name:'Retained precision',links:[],engine:3,policy:defaultCalculationPolicy(),cells:[['=sqrt(2)']],original:null};validateTool('sheet',data);
 data.policy.library.version='99.0.0';validateTool('sheet',data);assert.throws(()=>spreadsheet(data.cells,data),/library version is unavailable/);
 assert.throws(()=>validateTool('sheet',{...data,engine:2}));assert.throws(()=>calculate('1',{engine:2,policy:defaultCalculationPolicy()}),/historical/);
 const invalid=defaultCalculationPolicy();invalid.displayDigits=65;assert.equal(validCalculationPolicy(invalid),false);
 for(const key of ['workingDigits','displayDigits']){const p=defaultCalculationPolicy();p[key]=257;assert.equal(validCalculationPolicy(p),false);}
 for(const [key,value] of [['maxBits',65537],['maxOperations',50001],['maxMilliseconds',5001]]){const p=defaultCalculationPolicy();p.resources[key]=value;assert.equal(validCalculationPolicy(p),false);}
 assert.equal(checkpointHasCalculationPolicy({drafts:[{type:'sheet',data:{engine:3}}]}),true);
 assert.equal(checkpointHasCalculationPolicy({drafts:[{type:'sheet',data:{engine:2},base:{engine:3}}]}),true);
 assert.equal(checkpointHasCalculationPolicy({drafts:[{type:'reaction',data:{engine:3}}]}),false);
 const longer=defaultCalculationPolicy();longer.resources.maxMilliseconds=5000;assert.equal(calculationWorkerTimeout({engine:3,policy:longer}),7500);assert.equal(calculationWorkerTimeout({engine:2}),5000);
});
