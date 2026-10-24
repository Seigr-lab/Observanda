import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTopology,iterateTopologyVertices} from '../src/measurement-topology.js';
import {validTopologyDefinition,validTopologyKey,validTopologyVertex,validTopologyEdge,validTopologyOperation,topologyVertexSequenceDefinition,sameTopologySpace} from '../src/web/measurement-topology-model.js';
import {validSequenceDefinition} from '../src/web/measurement-sequence-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
const policy=changes=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...changes}});
const definition=changes=>({version:4,codec:'observanda.topology',codecVersion:1,namespace:'authored.vertex keys',direction:'directed',loops:'allow',parallelEdges:'allow',resourcePolicy:policy(),...changes});
const vertex=key=>({key}),edge=(key,from,to)=>({key,from,to});
function scratch({onGet,onPut}={}){const rows=new Map();return {rows,async get(key){await onGet?.(key);return structuredClone(rows.get(key));},async put(key,value){await onPut?.(key,value);rows.set(key,structuredClone(value));},async add(key,value){if(rows.has(key))return false;rows.set(key,structuredClone(value));return true;}};}
function source(vertices,edges,{definition:declared=definition(),vertexCount=vertices.length,edgeCount=edges.length,page}={}){const reads=[];return {definition:declared,vertexCount,edgeCount,reads,...Object.fromEntries([['readVertices',vertices,vertexCount,'vertices'],['readEdges',edges,edgeCount,'edges']].map(([name,values,count,kind])=>[name,async request=>{const {offset,limit}=request;assert.ok(limit>=1&&limit<=16);reads.push({kind,offset,limit});const items=Array.from({length:Math.min(limit,count-offset)},(_,i)=>structuredClone(typeof values==='function'?values(offset+i):values[offset+i])),result={items,offset,total:count,next:offset+items.length<count?offset+items.length:null};return page?await page(result,{...request,kind}):result;}]))};}
const fixture=changes=>source(['C','A','B','D'].map(vertex),[edge('ab1','A','B'),edge('ab2','A','B'),edge('ba','B','A'),edge('aa','A','A'),edge('cd','C','D')],changes);
const run=(operation,input=fixture(),options={})=>evaluateTopology(operation,input,{resourcePolicy:policy(),work:scratch(),...options});
const neighbors=(key,direction='out',offset=0,limit=16)=>({kind:'neighbors',vertex:key,direction,offset,limit});
const reachability=(from,direction='out',offset=0,limit=16)=>({kind:'reachability',from,direction,offset,limit});
const reachable=(from,to,direction='out')=>({kind:'reachable',from,to,direction});

test('topology declaration4 is explicit and strict; literal vertex-key namespaces become separate symbolic sequence declarations',()=>{
 assert.equal(validTopologyDefinition(definition()),true);for(const changed of [{version:1},{version:2},{version:3},{version:5},{codecVersion:2},{namespace:''},{namespace:'  '},{direction:'mixed'},{loops:'infer'},{parallelEdges:'infer'},{shape:[2]},{component:{representation:'integer',radix:10}},{resourcePolicy:null}])assert.equal(validTopologyDefinition({...definition(),...changed}),false);
 const keys=['A',' A ','two words','\u00e9','e\u0301','\u03b1\u2192\u03b2'];for(const key of keys)assert.equal(validTopologyKey(key),true);for(const key of ['', ' \t ', 'a\nb', 'a\u007fb', 'a\u0085b','x'.repeat(201),'\ud800','\ud801','\udfff'])assert.equal(validTopologyKey(key),false);assert.equal(validTopologyVertex({key:'A',weight:1}),false);assert.equal(validTopologyEdge({key:'ab',from:'A',to:'B',weight:1}),false);
 const output=topologyVertexSequenceDefinition(definition());assert.equal(validSequenceDefinition(output),true);assert.equal(output.namespace,definition().namespace);assert.deepEqual(output.element,{kind:'symbol'});assert.equal(Object.hasOwn(output,'direction'),false);assert.equal(Object.hasOwn(output,'frame'),false);assert.notEqual(output.resourcePolicy,definition().resourcePolicy);assert.equal(sameTopologySpace(definition(),definition({resourcePolicy:policy({maxOperations:1000})})),true);assert.equal(sameTopologySpace(definition(),definition({namespace:'another'})),false);
 for(const op of [{kind:'counts',extra:1},{kind:'degree',vertex:'A',direction:'forward'},neighbors('A','out',-1),neighbors('A','out',0,17),{kind:'isomorphic'}])assert.equal(validTopologyOperation(op),false);
});
test('exact counts include isolated vertices and parallel edges, and empty topology is a valid value',async()=>{
 const input=fixture(),actual=await run({kind:'counts'},input);assert.deepEqual(actual,{kind:'counts',vertices:{spelling:'4',representation:'integer',radix:10},edges:{spelling:'5',representation:'integer',radix:10},source:{operand:0}});assert.deepEqual(input.reads,[{kind:'vertices',offset:0,limit:4},{kind:'edges',offset:0,limit:5}]);
 const empty=source([],[]),zero=await run({kind:'counts'},empty);assert.equal(zero.vertices.spelling,'0');assert.equal(zero.edges.spelling,'0');assert.deepEqual(empty.reads,[]);await assert.rejects(run(reachable('unknown','unknown'),empty),{code:'MEASUREMENT_TOPOLOGY_KEY'});
});
test('directed degree counts a self-loop once in each direction while neighbor multiplicities count each edge once',async()=>{
 for(const [direction,count] of [['in','2'],['out','3'],['all','5']])assert.equal((await run({kind:'degree',vertex:'A',direction})).spelling,count);
 for(const [direction,multiplicities] of [['in',['1','1']],['out',['1','2']],['all',['1','3']]]){const result=await run(neighbors('A',direction));assert.deepEqual(result.items.map(item=>item.spelling),['A','B']);assert.deepEqual(result.items.map(item=>item.multiplicity.spelling),multiplicities);assert.deepEqual(result.items.map(item=>item.source),[{operand:0,vertex:1},{operand:0,vertex:2}]);assert.deepEqual(result.items.map(item=>item.index),[0,1]);assert.equal(result.definition.namespace,definition().namespace);assert.equal(result.definition.codec,'observanda.sequence');assert.equal(result.unit,'');assert.equal(result.unitDefinition,null);assert.equal(result.total,2);assert.equal(result.next,null);}
});
test('undirected self-loop has degree two and neighbor multiplicity one; reciprocal and parallel authored edges retain multiplicity',async()=>{
 const input=()=>fixture({definition:definition({direction:'undirected'})});assert.equal((await run({kind:'degree',vertex:'A',direction:'all'},input())).spelling,'5');const result=await run(neighbors('A','all'),input());assert.deepEqual(result.items.map(item=>[item.spelling,item.multiplicity.spelling]),[['A','1'],['B','3']]);for(const direction of ['in','out'])await assert.rejects(run(neighbors('A',direction),input()),{code:'MEASUREMENT_TOPOLOGY_DIRECTION'});
});
test('declared loop and parallel-edge rules use endpoint identities and directed reciprocal edges remain distinct',async()=>{
 const vertices=['A','B'].map(vertex),reciprocal=[edge('ab','A','B'),edge('ba','B','A')],make=(edges,changes)=>source(vertices,edges,{definition:definition(changes)});assert.equal((await run({kind:'counts'},make(reciprocal,{parallelEdges:'reject'}))).edges.spelling,'2');await assert.rejects(run({kind:'counts'},make(reciprocal,{direction:'undirected',parallelEdges:'reject'})),{code:'MEASUREMENT_TOPOLOGY_RULE'});
 await assert.rejects(run({kind:'counts'},make([edge('one','A','B'),edge('two','A','B')],{parallelEdges:'reject'})),{code:'MEASUREMENT_TOPOLOGY_RULE'});await assert.rejects(run({kind:'counts'},make([edge('aa','A','A')],{loops:'reject'})),{code:'MEASUREMENT_TOPOLOGY_RULE'});await assert.rejects(run({kind:'counts'},make([edge('ab','A','B'),edge('ab','B','A')],{})),{code:'MEASUREMENT_TOPOLOGY_DUPLICATE'});await assert.rejects(run({kind:'counts'},make([edge('ax','A','X')],{})),{code:'MEASUREMENT_TOPOLOGY_ENDPOINT'});
});
test('all source records are validated before counts, self-reach or unknown-key results, including malformed late pages',async()=>{
 const vertices=Array.from({length:33},(_,i)=>vertex('v'+i)),edges=Array.from({length:33},(_,i)=>edge('e'+i,'v0','v1'));for(const op of [{kind:'counts'},reachable('v0','v0'),reachable('unknown','unknown')]){const duplicate=source([...vertices.slice(0,32),vertex('v0')],edges);await assert.rejects(run(op,duplicate),{code:'MEASUREMENT_TOPOLOGY_DUPLICATE'});assert.equal(duplicate.reads.at(-1).offset,32);
 const invalid=source(vertices,[...edges.slice(0,32),edge('last','v0','missing')]);await assert.rejects(run(op,invalid),{code:'MEASUREMENT_TOPOLOGY_ENDPOINT'});assert.deepEqual(invalid.reads.at(-1),{kind:'edges',offset:32,limit:1});}
});
test('reachability is explicit by direction, includes an existing source itself, and emits authored vertex order',async()=>{
 for(const [from,to,direction,value] of [['A','A','out',true],['A','B','out',true],['A','C','out',false],['C','D','out',true],['D','C','out',false],['D','C','in',true],['D','C','all',true]])assert.equal((await run(reachable(from,to,direction))).value,value);
 const page=await run(reachability('D','all',0,1));assert.deepEqual(page.items.map(item=>item.spelling),['C']);assert.deepEqual(page.items[0].source,{operand:0,vertex:0});assert.equal(page.total,2);assert.equal(page.next,1);const last=await run(reachability('D','all',1,1));assert.deepEqual(last.items.map(item=>item.spelling),['D']);assert.equal(last.items[0].index,1);assert.equal(last.next,null);assert.deepEqual((await run(reachability('D','all',2))).items,[]);await assert.rejects(run(reachability('D','all',3)),{code:'MEASUREMENT_TOPOLOGY_INDEX'});
 for(const operation of [reachable('missing','A'),reachable('A','missing'),neighbors('missing'),{kind:'degree',vertex:'missing',direction:'all'}])await assert.rejects(run(operation),{code:'MEASUREMENT_TOPOLOGY_KEY'});
});
test('literal Unicode and embedded spaces are retained without normalization or index collision',async()=>{
 const keys=[' A ','A','\u00e9','e\u0301'],input=source(keys.map(vertex),keys.slice(1).map((key,i)=>edge('edge '+i,keys[0],key))),result=await run(reachability(keys[0]),input);assert.deepEqual(result.items.map(item=>item.spelling),keys);assert.deepEqual(result.items.map(item=>item.source.vertex),[0,1,2,3]);
});
test('large topology uses only bounded source and result pages with scratch-indexed traversal and stable source ordinals',async()=>{
 const count=1025,input=source(i=>vertex('v'+i),i=>edge('e'+i,'v'+i,'v'+(i+1)),{vertexCount:count,edgeCount:count-1}),work=scratch(),result=await run(reachability('v0','out',1000,16),input,{work,resourcePolicy:policy({maxOperations:1000000})});assert.equal(result.total,count);assert.equal(result.items.length,16);assert.equal(result.next,1016);assert.deepEqual(result.items.map(item=>item.spelling),Array.from({length:16},(_,i)=>'v'+(1000+i)));assert.deepEqual(result.items.map(item=>item.source.vertex),Array.from({length:16},(_,i)=>1000+i));assert.equal(input.reads.length,Math.ceil(count/16)+Math.ceil((count-1)/16));assert.ok(input.reads.every(page=>page.limit<=16));assert.ok([...work.rows.values()].every(value=>!Array.isArray(value)));
 // The caller may reuse its scratch owner; each invocation has isolated keys.
 assert.equal((await run({kind:'counts'},source([vertex('v0')],[]),{work})).vertices.spelling,'1');
});
test('malformed pages and record fields fail closed without accepting a partial graph',async()=>{
 for(const change of [page=>({...page,offset:1}),page=>({...page,total:99}),page=>({...page,next:1}),page=>({...page,items:[]}),page=>({...page,items:[{key:'A',extra:true}]})])await assert.rejects(run({kind:'counts'},source([vertex('A')],[],{page:change})),{code:'MEASUREMENT_TOPOLOGY_INPUT'});
 for(const item of [{key:'edge',from:'A',to:'A',weight:1},{key:'edge',from:'A',to:'\n'}])await assert.rejects(run({kind:'counts'},source([vertex('A')],[item])),{code:'MEASUREMENT_TOPOLOGY_INPUT'});
});
test('cancellation and access loss are checked around source/scratch I/O and during traversal',async()=>{
 const cancelled=new AbortController(),input=fixture({page:page=>{cancelled.abort();return page;}});await assert.rejects(run({kind:'counts'},input,{signal:cancelled.signal}),{name:'AbortError'});assert.equal(input.reads.length,1);
 const traversal=new AbortController(),work=scratch({onGet:key=>{if(key.endsWith(':queue:0'))traversal.abort();}});await assert.rejects(run(reachability('A'),fixture(),{work,signal:traversal.signal}),{name:'AbortError'});
 const denied=Object.assign(Error('Denied'),{code:'RECORD_OWNER_DENIED'}),unread=fixture();await assert.rejects(run({kind:'counts'},unread,{check:()=>{throw denied;}}),error=>error===denied);assert.equal(unread.reads.length,0);let checks=0;await assert.rejects(run(reachable('A','A'),fixture(),{check:()=>{if(++checks===20)throw denied;}}),error=>error===denied);
});
test('source-owned key limits, whole-operation budgets and already consumed work cannot borrow larger allowances',async()=>{
 const long='x'.repeat(17);await assert.rejects(run({kind:'counts'},source([vertex(long)],[],{definition:definition({resourcePolicy:policy({maxScalarCharacters:16})})})),{code:'DATASET_CALCULATION_RESOURCE'});await assert.rejects(run({kind:'counts'},source([vertex(long)],[]),{resourcePolicy:policy({maxScalarCharacters:16})}),{code:'DATASET_CALCULATION_RESOURCE'});await assert.rejects(run({kind:'counts'},source([vertex('abcdef')],[],{definition:definition({resourcePolicy:policy({maxOperations:4})})})),{code:'DATASET_CALCULATION_RESOURCE'});
 const own=policy({maxOperations:100}),budget=new DatasetResourceBudget(own);budget.run(()=>{for(let i=0;i<99;i++)budget.step();});await assert.rejects(run({kind:'counts'},fixture(),{resourcePolicy:own,budget}),{code:'DATASET_CALCULATION_RESOURCE'});await assert.rejects(run({kind:'counts'},fixture(),{budget:new DatasetResourceBudget(policy({maxBits:128}))}),{code:'MEASUREMENT_TOPOLOGY_INVALID'});await assert.rejects(run(reachability('A'),fixture(),{resourcePolicy:policy({maxOperations:80})}),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('waiting for authenticated pages does not consume active numerical time',async()=>{
 const input=source([vertex('A')],[],{page:async page=>{await new Promise(resolve=>setTimeout(resolve,75));return page;}}),start=performance.now(),result=await run({kind:'counts'},input,{resourcePolicy:policy({maxMilliseconds:50})});assert.equal(result.vertices.spelling,'1');assert.ok(performance.now()-start>=70);
});

test('complete topology vertex sequences stream every selected key without repeating source validation',async()=>{
 const count=129,input=source(Array.from({length:count},(_,i)=>vertex('v'+i)),Array.from({length:count-1},(_,i)=>edge('e'+i,'v0','v'+(i+1)))),options={resourcePolicy:policy({maxOperations:1000000}),work:scratch()},iterator=iterateTopologyVertices({kind:'neighbors',vertex:'v0',direction:'out'},input,options);let result,seen=0;
 for(;;){const next=await iterator.next();if(next.done){result=next.value;break;}assert.equal(next.value.index,seen);assert.equal(next.value.spelling,'v'+(seen+1));assert.equal(next.value.source.vertex,seen+1);assert.equal(next.value.multiplicity.spelling,'1');seen++;}
 assert.equal(seen,128);assert.equal(result.count,128);assert.equal(result.kind,'sequence');assert.equal(result.definition.namespace,input.definition.namespace);assert.equal(input.reads.length,Math.ceil(count/16)+Math.ceil((count-1)/16));assert.ok(input.reads.every(read=>read.limit<=16));
 const reachableKeys=[];for await(const item of iterateTopologyVertices({kind:'reachability',from:'D',direction:'all'},fixture(),{resourcePolicy:policy(),work:scratch()}))reachableKeys.push(item.spelling);assert.deepEqual(reachableKeys,['C','D']);
});
test('returning early from a topology result stops scratch reads and cancellation refuses later elements',async()=>{
 let reads=0;const owner=scratch({onGet:()=>{reads++;}}),iterator=iterateTopologyVertices({kind:'neighbors',vertex:'A',direction:'out'},fixture(),{resourcePolicy:policy(),work:owner});assert.equal((await iterator.next()).value.spelling,'A');await iterator.return();const closed=reads;assert.equal((await iterator.next()).done,true);assert.equal(reads,closed);
 const controller=new AbortController(),cancelled=iterateTopologyVertices({kind:'neighbors',vertex:'A',direction:'out'},fixture(),{resourcePolicy:policy(),work:scratch(),signal:controller.signal});await cancelled.next();controller.abort();await assert.rejects(cancelled.next(),{name:'AbortError'});assert.equal((await cancelled.next()).done,true);
});
