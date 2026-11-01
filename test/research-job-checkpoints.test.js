import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchJobDefinitions} from '../src/research-jobs.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';

for(const supplied of [true,false])test('research jobs use renewing admitted checkpoints: '+(supplied?'worker':'direct'),async t=>{
 let writes=0,checked=0;
 const write=async operation=>{writes++;return operation();};
 const queue={checkpoint:async(id,token,operation)=>{assert.equal(id,'job');assert.equal(token,'lease');checked++;return operation();},transaction:()=>{throw Error('Unadmitted write bypassed the worker checkpoint');}};
 const prepare=async(_command,{writePage})=>{await writePage(()=>42);return 'prepared';};
 t.mock.method(ResearchMaterials.prototype,'prepareDataset',prepare);
 t.mock.method(ResearchMaterials.prototype,'preparePlot',prepare);
 t.mock.method(ResearchMaterials.prototype,'cleanPlotWork',async(_id,_attempt,writePage)=>writePage(()=>42));
 t.mock.method(AnalysisComparisons.prototype,'prepare',prepare);
 t.mock.method(AnalysisComparisons.prototype,'references',()=>[]);
 t.mock.method(ResearchMaterials.prototype,'cleanAttempts',async()=>{});
 t.mock.method(ResearchMaterials.prototype,'prepareImport',async()=> 'prepared');
 const workspace={outline:async()=>({metadata:{id:'workspace'}})},definitions=researchJobDefinitions(workspace,()=>queue),job={id:'job',lease:{token:'lease'},input:{command:{comparison:{version:1}}}};
 for(const type of ['dataset.prepare','figure.calculate','analysis.compare','evidence.finalize'])assert.equal(await definitions[type].prepare(job,supplied?{write}:{}),'prepared');
 assert.equal(writes,supplied?5:0);assert.equal(checked,supplied?0:5);
});
