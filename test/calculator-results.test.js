import {approximateCalculatorMetadata} from '../src/approximate-calculator-format.js';
import {calculatorResultColumn} from '../src/calculator-result-values.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {validCalculatorRecipe} from '../src/web/calculator-result-model.js';
import {validateTool} from '../src/modules/tools.js';
import {CalculatorResults} from '../src/calculator-results.js';
import {digest} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {AppError} from '../src/errors.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {captureCalculatorRecipe,captureCalculatorResultRecipe,evaluateCalculatorRecipe} from '../src/calculator-result-evaluation.js';
import {calculatorResultClient} from '../src/web/calculator-result-client.js';
import {defaultCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {projectApiRoute} from '../src/web/project-context.js';
const entity=(expression='1/3',engine=3)=>({id:id(),type:'calculation',revision:2,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z',data:{name:'Exact result',links:[],engine,...(engine===3?{policy:defaultCalculationPolicy()}:{}),mode:'expression',angle:'rad',expression,digits:'',fromBase:10,toBase:6}});
const source=e=>({workspaceId:id(),type:'calculation',id:e.id,revision:e.revision});
const ref=kind=>({kind,id:id(),revision:'a'.repeat(64)});
const setup=()=>{const e=entity(),draft={id:e.id,type:e.type,expectedRevision:e.revision,base:structuredClone(e.data),data:structuredClone(e.data)},state={page:'module',moduleId:'scientific-calculator',modulePath:'calculation/'+e.id,book:{id:id()},storage:{contextId:id()},projectOwner:{projectId:id()}};return {draft,state};};
const destination=()=>{const namespace=id(),record=id();return {owner:{workspaceId:namespace,projectId:id(),labBookId:id()},reference:{workspaceId:namespace,type:'record',id:record},openType:'record',openId:record,title:'Chosen record'};};
const pending=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve:value=>resolve(value),reject:error=>reject(error)};};
const receipt=(workspaceId,jobId)=>({workspaceId,recipe:ref('analysis'),job:{id:jobId,type:'dataset.prepare',state:'queued'}});

test('capture retains exact computational value and the authenticated source revision, not display digits or unrelated links',()=>{
 const e=entity('999\n1/3'),s=source(e);e.data.policy.displayDigits=1;e.data.links=[{workspaceId:id(),type:'record',id:id()}];const captured=captureCalculatorRecipe(s,e,1),before=structuredClone(captured);
 assert.deepEqual(evaluateCalculatorRecipe(captured),{numerator:'1',denominator:'3',spelling:'1/3'});assert.deepEqual(captured.source,{...s,entityHash:captured.source.entityHash});assert.match(captured.source.entityHash,/^[a-f0-9]{64}$/);assert.equal(captured.expression,'1/3');assert.equal(captured.expressionIndex,1);assert.equal(captured.scope,'selected-expression');assert.equal(JSON.stringify(captured).includes(e.data.links[0].id),false);
 e.data.expression='999\n2/3';e.data.policy.displayDigits=40;assert.deepEqual(captured,before);assert.equal(evaluateCalculatorRecipe(captured).spelling,'1/3');assert.throws(()=>captureCalculatorRecipe({...s,revision:3},e,1),{code:'CALCULATOR_RESULT_INVALID'});
 const other=captureCalculatorRecipe({...s,workspaceId:id()},e,1);assert.notEqual(other.source.workspaceId,captured.source.workspaceId);assert.equal(evaluateCalculatorRecipe(other).spelling,'2/3');
});

test('independent expression scope refuses dependent names, assignments, units and approximation without substituting cached results',()=>{
 for(const expression of ['ans+1','A1+1','x+1','x=2','sqrt(2)','2 cm to m','pi']){const e=entity(expression);assert.throws(()=>evaluateCalculatorRecipe(captureCalculatorRecipe(source(e),e,0)),{code:'CALCULATOR_RESULT_EXACT'},expression);}
 const e=entity('x=2\nx+1');assert.throws(()=>evaluateCalculatorRecipe(captureCalculatorRecipe(source(e),e,1)),{code:'CALCULATOR_RESULT_EXACT'});
 const legacy=entity('1/3',1);assert.throws(()=>captureCalculatorRecipe(source(legacy),legacy,0),{code:'CALCULATOR_RESULT_EXACT'});
 const historical=entity('9007199254740993+1',2);assert.equal(evaluateCalculatorRecipe(captureCalculatorRecipe(source(historical),historical,0)).spelling,'9007199254740994/1');
});

test('saved budgets and pinned library refuse explicitly while a new captured policy can admit the exact operation',()=>{
 const e=entity('2^1000');e.data.policy.resources.maxBits=64;const limited=captureCalculatorRecipe(source(e),e,0);assert.throws(()=>evaluateCalculatorRecipe(limited),{code:'CALCULATOR_RESULT_RESOURCE'});
 e.revision++;e.data.policy.resources.maxBits=2048;const admitted=captureCalculatorRecipe(source(e),e,0);assert.equal(evaluateCalculatorRecipe(admitted).numerator,String(2n**1000n));assert.equal(limited.policy.resources.maxBits,64);
 const unavailable=structuredClone(admitted);unavailable.library.version=unavailable.policy.library.version='99.0.0';assert.throws(()=>evaluateCalculatorRecipe(unavailable),{code:'CALCULATOR_RESULT_LIBRARY'});
});

test('retention is addressed to the explicitly selected destination while source identity and command IDs remain fixed through unlock',async()=>{
 const {state,draft}=setup(),chosen=destination(),before=structuredClone({state,draft}),calls=[];let prompts=0;const ids={recipeId:id(),jobId:id(),title:'Exact third'};
 const client=calculatorResultClient({state,current:()=>draft,researchApi:async(route,body,options)=>{calls.push({route,body,options});if(calls.length===1)throw {code:'ACCESS_LOCKED',projectId:chosen.owner.projectId};return receipt(chosen.owner.workspaceId,ids.jobId);},access:async run=>{try{return await run();}catch(error){assert.equal(error.code,'ACCESS_LOCKED');prompts++;return run();}}}),captured=client.capture(0),dest=client.destination(chosen);
 await client.retain(captured,dest,ids);assert.equal(prompts,1);assert.deepEqual({state,draft},before);assert.equal(calls.length,2);assert.deepEqual(calls[0].body,calls[1].body);assert.equal(calls[0].body.workspaceId,chosen.owner.workspaceId);assert.equal(calls[0].body.source.workspaceId,state.book.id);assert.equal(calls[0].body.recordId,chosen.openId);assert.equal(calls[0].body.source.revision,draft.expectedRevision);assert.equal(calls[0].route,projectApiRoute('/api/research/materials/calculator-retain',dest.owner));assert.deepEqual(calls[0].options.owner,dest.owner);assert.equal(calls[0].options.adopt,false);
});

test('late source and destination failures cannot prompt or repaint after owner, draft, route or session changes',async()=>{
 for(const change of [(state)=>state.book.id=id(),(state)=>state.projectOwner={projectId:id()},(state)=>state.page='entries',(_state,draft)=>draft.data.expression='2/3',(state)=>state.storage.contextId=id()]){
  const {state,draft}=setup(),held=pending(),chosen=destination(),ids={recipeId:id(),jobId:id(),title:'Exact'};let prompts=0;
  const client=calculatorResultClient({state,current:()=>draft,researchApi:()=>held.promise,access:async run=>{try{return await run();}catch(error){if(error.code==='ACCESS_LOCKED')prompts++;throw error;}}}),captured=client.capture(0),dest=client.destination(chosen),operation=client.retain(captured,dest,ids),rejected=assert.rejects(operation,{name:'AbortError'});change(state,draft);held.reject({code:'ACCESS_LOCKED',projectId:id()});await rejected;assert.equal(prompts,0);
 }
 const {state,draft}=setup(),held=pending(),chosen=destination(),ids={recipeId:id(),jobId:id(),title:'Exact'},client=calculatorResultClient({state,current:()=>draft,researchApi:()=>held.promise}),captured=client.capture(0),dest=client.destination(chosen),operation=client.retain(captured,dest,ids),rejected=assert.rejects(operation,{name:'AbortError'});client.cancel();held.resolve(receipt(dest.workspaceId,ids.jobId));await rejected;
});

test('unsaved edits and unbound destinations cannot start capture, while passive job checks never ask for access',async()=>{
 const {state,draft}=setup();let prompts=0,calls=0;const client=calculatorResultClient({state,current:()=>draft,researchApi:async()=>{calls++;throw {code:'ACCESS_LOCKED'};},access:async run=>{prompts++;return run();}}),captured=client.capture(0),dest=client.destination(destination());
 await assert.rejects(client.status(captured,dest,id()),{code:'ACCESS_LOCKED'});assert.equal(prompts,0);assert.equal(calls,1);assert.throws(()=>client.destination({reference:{type:'record',id:id()}}),/CALCULATOR_RESULT_RESPONSE/);
 draft.data.expression='4/3';assert.throws(()=>client.capture(0),/CALCULATOR_RESULT_SAVED/);await assert.rejects(client.retain(captured,dest,{recipeId:id(),jobId:id(),title:'Wrong draft'}),{name:'AbortError'});assert.equal(calls,1);
});

function serviceFixture(){
 const namespace=id(),recordId=id(),e=entity(),heads=new Map(),documents=new Map(),jobs=new Map();let writable=true,readCount=0,closes=0,verifications=0,interrupt=false,sourceRevoked=false,onLock=()=>{};
 const materials={workspace:{outline:async()=>({metadata:{id:namespace}}),withLock:async run=>{onLock();return run();}},assertOwner:async record=>{assert.equal(record,recordId);if(!writable)throw new AppError('ACCESS_DENIED');},current:async id=>heads.get(id)??null,read:async ref=>{const doc=documents.get(ref.id+':'+ref.revision);if(!doc)throw new AppError('MATERIAL_MISSING');return structuredClone(doc);},commit:async command=>{const previous=heads.get(command.id)?.revision??null;assert.equal(command.expectedRevision,previous);const doc={format:1,kind:command.kind,id:command.id,recordId,title:command.title,createdAt:'2026-01-02T00:00:00.000Z',previous,content:structuredClone(command.content)},ref={kind:command.kind,id:command.id,revision:digest(revisionText(doc))};documents.set(ref.id+':'+ref.revision,doc);heads.set(ref.id,ref);return ref;}};
 const queue={read:async id=>jobs.get(id)??null,authorize:async()=>{if(!writable)throw new AppError('ACCESS_DENIED');}},service=new CalculatorResults(materials,{enqueue:async(_m,_q,command,jobId)=>{if(interrupt)throw new AppError('LOCKED');const job={id:jobId,type:'dataset.prepare',scope:recordId,state:'queued',attempt:0,progress:{stage:'queued',done:0,total:1},input:{command},result:null};jobs.set(jobId,job);return job;}}),command={workspaceId:namespace,recordId,title:'Captured third',source:source(e),expressionIndex:0,recipeId:id(),jobId:id()};
 const readSource=async()=>{readCount++;return {entity:structuredClone(e),verify:async()=>{verifications++;if(sourceRevoked)throw new AppError('ACCESS_LOCKED');},close:async()=>{closes++;}};};
 return {materials,queue,service,command,e,heads,documents,jobs,readSource,get readCount(){return readCount;},get closes(){return closes;},get verifications(){return verifications;},set writable(v){writable=v;},set sourceRevoked(v){sourceRevoked=v;},set interrupt(v){interrupt=v;},set onLock(v){onLock=v;}};
}

test('source and destination authority are rechecked at recipe commit with no partial dataset or recipe',async()=>{
 for(const boundary of ['source','destination']){const f=serviceFixture();f.onLock=()=>{if(boundary==='source')f.sourceRevoked=true;else f.writable=false;};await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:boundary==='source'?'ACCESS_LOCKED':'ACCESS_DENIED'});assert.equal(f.heads.size,0);assert.equal(f.jobs.size,0);assert.equal(f.readCount,1);assert.equal(f.closes,1);assert.equal(f.verifications,2);}
});

test('interruption after capture resumes the exact immutable recipe without rereading a changed or locked source',async()=>{
 const f=serviceFixture();f.interrupt=true;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'LOCKED'});assert.equal(f.heads.has(f.command.recipeId),true);assert.equal(f.heads.has(f.command.jobId),false);assert.equal(f.jobs.size,0);
 f.e.data.expression='2/3';f.e.revision++;f.sourceRevoked=true;f.interrupt=false;const restarted=new CalculatorResults(f.materials,{enqueue:f.service.enqueue}),recipe=f.heads.get(f.command.recipeId),receipt=await restarted.resume(f.queue,{workspaceId:f.command.workspaceId,ref:recipe});assert.deepEqual(f.jobs.get(f.command.jobId).input.command,{recordId:f.command.recordId,title:f.command.title,id:f.command.jobId,expectedRevision:null,calculatorResult:{version:1,recipe}});assert.equal(evaluateCalculatorRecipe((await f.materials.read(receipt.recipe)).content.recipe).spelling,'1/3');assert.equal(f.readCount,1);assert.equal(f.heads.has(f.command.jobId),false);
 f.jobs.get(f.command.jobId).state='cancelled';const replay=await f.service.retain(f.queue,f.command,{readSource:()=>assert.fail('No source read on replay')});assert.equal(replay.job.state,'cancelled');assert.equal(replay.job.result,null);assert.equal(f.heads.has(f.command.jobId),false);await assert.rejects(f.service.retain(f.queue,{...f.command,title:'Changed replay'},{readSource:f.readSource}),{code:'MODULE_REPLAY'});
 f.writable=false;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'ACCESS_DENIED'});
});

test('verification reports unavailable pinned computation without misclassifying it as catalogue damage',async()=>{
 for(const code of ['CALCULATOR_RESULT_LIBRARY','CALCULATOR_RESULT_RESOURCE']){const f=serviceFixture();await f.service.retain(f.queue,f.command,{readSource:f.readSource});const doc=await f.materials.read(f.heads.get(f.command.recipeId));if(code==='CALCULATOR_RESULT_LIBRARY'){doc.content.recipe.library.version=doc.content.recipe.policy.library.version='99.0.0';}else{doc.content.recipe.expression=doc.content.parameters='2^1000';doc.content.recipe.policy.resources.maxBits=64;}const service=new CalculatorResults({read:async()=>doc});await assert.rejects(service.verify(doc),{code});}
});


test('captured result admission and resume reject altered public dataset intents and job scopes',async()=>{
 const f=serviceFixture();f.interrupt=true;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'LOCKED'});const recipe=f.heads.get(f.command.recipeId),doc=await f.materials.read(recipe),input={...doc.content.capture.intent,calculatorResult:{version:1,recipe}};await f.service.validate(input);f.materials.assertOwner=async()=>{};
 for(const change of [{title:'Different result'},{id:id()},{expectedRevision:'b'.repeat(64)},{recordId:id()}]){
  const command={...input,...change};await assert.rejects(f.service.validate(command),{code:'CALCULATOR_RESULT_INVALID'});
  f.jobs.set(f.command.jobId,{id:f.command.jobId,type:'dataset.prepare',scope:f.command.recordId,state:'queued',input:{command}});await assert.rejects(f.service.resume(f.queue,{workspaceId:f.command.workspaceId,ref:recipe}),{code:'MODULE_REPLAY'});
 }
 f.jobs.set(f.command.jobId,{id:f.command.jobId,type:'dataset.prepare',scope:id(),state:'queued',input:{command:input}});await assert.rejects(f.service.resume(f.queue,{workspaceId:f.command.workspaceId,ref:recipe}),{code:'MODULE_REPLAY'});
});


test('recipe2 captures only exact structured values under its own engine and policy while old recipes stay scalar',async()=>{
 const e=entity('[1/3,9007199254740993+1]');e.data.engine=4;e.data.policy=defaultStructuredCalculationPolicy();const recipe=captureCalculatorRecipe(source(e),e,0),result=evaluateCalculatorRecipe(recipe);assert.equal(recipe.version,2);assert.deepEqual(recipe.structuredEngine,{name:'observanda-exact-structured',version:1});assert.deepEqual(result.structured,{version:1,codec:'vector',shape:[2],components:[{numerator:'1',denominator:'3'},{numerator:'9007199254740994',denominator:'1'}]});
 assert.ok(validCalculatorRecipe(recipe));for(const altered of [{version:1},{engine:3},{policy:defaultCalculationPolicy()},{structuredEngine:{name:'observanda-exact-structured',version:2}}])assert.ok(!validCalculatorRecipe({...recipe,...altered}));
 assert.throws(()=>validateTool('calculation',{...e.data,engine:3}));assert.throws(()=>validateTool('calculation',{...e.data,policy:defaultCalculationPolicy()}));assert.throws(()=>validateTool('sheet',{name:'No implicit sheet upgrade',links:[],engine:4,policy:e.data.policy,cells:[['1']],original:null}));
 for(const expression of ['sqrt(2)','2 cm to m']){const other={...e,data:{...e.data,expression}};assert.throws(()=>evaluateCalculatorRecipe(captureCalculatorRecipe(source(other),other,0)),{code:'CALCULATOR_RESULT_EXACT'});}
 const limited=structuredClone(recipe);limited.policy.resources.maxComponents=1;assert.throws(()=>evaluateCalculatorRecipe(limited),{code:'CALCULATOR_RESULT_RESOURCE'});
 const f=serviceFixture();f.e.data={...e.data};f.interrupt=true;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'LOCKED'});const ref=f.heads.get(f.command.recipeId);f.interrupt=false;f.sourceRevoked=true;await f.service.resume(f.queue,{workspaceId:f.command.workspaceId,ref});assert.equal(f.jobs.get(f.command.jobId).input.command.calculatorResult.version,2);assert.equal(f.readCount,1);assert.deepEqual(evaluateCalculatorRecipe((await f.materials.read(ref)).content.recipe).structured,result.structured);
});


test('recipe3 captures complete approximate decimals independently of display while historical recipes remain exact',()=>{
 const e=entity('sqrt(2)');e.data.engine=4;e.data.policy=defaultStructuredCalculationPolicy();e.data.policy.displayDigits=3;
 const recipe=captureCalculatorResultRecipe(source(e),e,0),value=evaluateCalculatorRecipe(recipe),pinned=ref('analysis');assert.equal(recipe.version,3);assert.equal(validCalculatorRecipe(recipe),true);assert.equal(value.spelling,'1.414213562373095048801688724209698078569671875376948073176679738');
 const column=calculatorResultColumn(recipe,value,pinned);assert.equal(column.representation,'decimal');assert.deepEqual(column.computation,{version:1,kind:'approximate',recipe:pinned});assert.equal(column.resourcePolicy.resources.maxExponent,0);
 e.data.policy.displayDigits=40;assert.equal(evaluateCalculatorRecipe(captureCalculatorResultRecipe(source(e),e,0)).spelling,value.spelling);assert.throws(()=>evaluateCalculatorRecipe({...recipe,version:2}),{code:'CALCULATOR_RESULT_EXACT'});
 for(const expression of ['sin(-0)','exp(1000)']){e.data.expression=expression;const captured=captureCalculatorResultRecipe(source(e),e,0),result=evaluateCalculatorRecipe(captured),definition=calculatorResultColumn(captured,result,pinned);assert.equal(result.spelling,expression==='sin(-0)'?'-0':result.spelling);assert.equal(definition.resourcePolicy.resources.maxExponent,expression==='sin(-0)'?0:434);}
 e.data.expression='1/3';assert.equal(captureCalculatorResultRecipe(source(e),e,0).version,2);assert.throws(()=>evaluateCalculatorRecipe({...recipe,expression:'1/3'}),{code:'CALCULATOR_RESULT_EXACT'});
 for(const expression of ['2 cm to m','sqrt(-2)','exp(1e100)']){e.data.expression=expression;assert.throws(()=>captureCalculatorResultRecipe(source(e),e,0),{code:'CALCULATOR_RESULT_EXACT'});}
 const old=entity('sqrt(2)');assert.throws(()=>captureCalculatorResultRecipe(source(old),old,0),{code:'CALCULATOR_RESULT_EXACT'});
});

test('approximate capture refuses its full representation budget before persisting and recovers pinned recipe3 without source grants',async()=>{
 const f=serviceFixture();f.e.data.engine=4;f.e.data.policy=defaultStructuredCalculationPolicy();f.e.data.expression='sqrt(2)';f.e.data.policy.resources.maxResultCharacters=32;
 await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'CALCULATOR_RESULT_RESOURCE'});assert.equal(f.heads.size,0);assert.equal(f.jobs.size,0);
 f.e.data.policy=defaultStructuredCalculationPolicy();f.e.data.policy.resources.maxBits=64;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'CALCULATOR_RESULT_RESOURCE'});assert.equal(f.heads.size,0);
 f.e.data.policy=defaultStructuredCalculationPolicy();f.interrupt=true;await assert.rejects(f.service.retain(f.queue,f.command,{readSource:f.readSource}),{code:'LOCKED'});const recipe=f.heads.get(f.command.recipeId),saved=await f.materials.read(recipe);assert.equal(saved.content.recipe.version,3);const count=f.readCount;f.sourceRevoked=true;f.interrupt=false;f.e.data.expression='sin(0)';
 await f.service.resume(f.queue,{workspaceId:f.command.workspaceId,ref:recipe});assert.equal(f.jobs.get(f.command.jobId).input.command.calculatorResult.version,3);assert.equal(f.readCount,count);assert.ok(evaluateCalculatorRecipe(saved.content.recipe).spelling.startsWith('1.414213562373095'));await f.service.verify(saved);
});


test('approximate admission follows only known bounded metadata carriers',()=>{
 const marker={version:1,kind:'approximate-inputs'};
 for(const [path,value]of [['.observanda/materials/objects/result/revision.json',{content:{approximateComputations:1}}],['.observanda/materials/objects/measurement/revision.json',{content:{measurement:{computation:marker}}}],['.observanda/materials/sequences/chunks/hash.json',{kind:'columns-policy',items:[{computation:marker}]}],['.observanda/materials/figures/value/hash.json',{type:'property',name:'computation',value:'hash'}],['.observanda/materials/figures/value/hash.json',{type:'inline',value:{computation:marker}}],['.observanda/materials/comparison-work/job.json',{summary:{computation:marker}}],['.observanda/jobs/job.json',{input:{command:{calculatorResult:{version:3}}}}]])assert.equal(approximateCalculatorMetadata(path,value),true,path);
 for(const [path,value]of [['.observanda/materials/sequences/chunks/hash.json',{kind:'cell-text',items:[JSON.stringify({computation:marker})]}],['.observanda/materials/figures/value/hash.json',{type:'inline',value:'computation'}],['.observanda/materials/comparison-work/job.json',{note:{computation:marker}}],['arbitrary/private.json',{content:{approximateComputations:1}}]])assert.equal(approximateCalculatorMetadata(path,value),false,path);
});
