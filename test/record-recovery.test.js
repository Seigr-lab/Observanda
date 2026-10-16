import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeRecoveryValue} from '../src/web/record-recovery-value.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {recordRecoveryMessage} from '../src/web/record-recovery-messages.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const book={projects:[{id:'project',title:'Project name'}],notebooks:[{id:'notebook',projectId:'project',title:'Book name'}]};
test('conflict descriptions distinguish numeric, missing and boolean values without interpreting authored text',()=>{
 assert.equal(describeRecoveryValue({min:0,max:-2,legend:false},book),'min: 0\nmax: -2\nlegend: No');
 assert.equal(describeRecoveryValue(-0,book),'-0');
 assert.equal(describeRecoveryValue([0,null,undefined,false],book),'0\nNone\nRemoved\nNo');
 assert.equal(describeRecoveryValue(false,book,{field:'share'}),'Private');
 assert.equal(describeRecoveryValue('9007199254740993',book),'9007199254740993');
 assert.equal(describeRecoveryValue('notebook',book,{field:'title'}),'notebook');
 assert.equal(describeRecoveryValue('notebook',book,{field:'notebookId'}),'Project name / Book name');
 const prose={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'<authored> field.title {name}'}]}]};
 assert.ok(describeRecoveryValue(prose,book).startsWith('<authored> field.title {name}\n'));
});
test('message ownership changes conflict labels without changing paths, choices or scientific values',()=>{
 const base={id:'record',title:'Authored {name}',body:'Original',sections:[],attachments:[],contributors:[],relations:[],figures:[],notebookId:'notebook',share:false};
 const mine={...base,body:'9007199254740993'},saved={...base,body:'Retained <value>'},changes=[{base,record:mine}];
 const seen=[],message=(key,args)=>{seen.push(key);return '['+recordRecoveryMessage(key,args)+']';};
 const standard=reconcileRecords(changes,[saved]),translated=reconcileRecords(changes,[saved],{message});
 assert.equal(translated.conflicts[0].label,'[Summary / context]');
 assert.equal(translated.conflicts[0].key,standard.conflicts[0].key);
 assert.equal(translated.summaries[0].title,'Authored {name}');
 assert.deepEqual(translated.resolve(new Map(translated.conflicts.map(c=>[c.key,c.mine]))),standard.resolve(new Map(standard.conflicts.map(c=>[c.key,c.mine]))));
 assert.ok(seen.includes('field.body'));assert.ok(!seen.includes(mine.body));
 assert.equal(describeRecoveryValue({title:'Authored {name}',min:0,max:null},book,{message}),'[Title]: Authored {name}\nmin: 0\nmax: [None]');
 assert.throws(()=>translated.resolve(new Map()),/Choose a version/);
});

test('independent result statements merge but a changed statement retains its evidence as one reviewed value',()=>{
 const result=(id,text)=>({id,kind:'number',title:id,text,basis:'authored',source:null,limitations:'Declared scope'});
 const base={id:'record',title:'Result record',body:'',sections:[],attachments:[],contributors:[],relations:[],figures:[],notebookId:'notebook',share:false,results:{version:1,statements:[result('a','1/3'),result('b','10')]}},mine=structuredClone(base),stored=structuredClone(base);
 mine.results.statements[0].text='2/3';stored.results.statements[1].text='11';
 let plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,0);
 assert.deepEqual(plan.resolve(new Map())[0].results.statements.map(s=>s.text),['2/3','11']);
 stored.results.statements[0]={...stored.results.statements[0],basis:'retained',source:{kind:'analysis',id:'retained',revision:'exact'},text:'Retained calculation'};
 plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,1);
 const conflict=plan.conflicts[0];assert.deepEqual(conflict.mine,mine.results.statements[0]);assert.deepEqual(conflict.stored,stored.results.statements[0]);
 assert.deepEqual(plan.resolve(new Map([[conflict.key,conflict.mine]]))[0].results.statements,[mine.results.statements[0],stored.results.statements[1]]);
 assert.deepEqual(plan.resolve(new Map([[conflict.key,conflict.stored]]))[0].results,stored.results);
});

test('recovery preserves explicit optional-field removal and concurrent additions',()=>{
 const base={id:'record',title:'Result record',body:'',sections:[],attachments:[],contributors:[],relations:[],figures:[],notebookId:'notebook',share:false,results:{version:1,statements:[]}},mine=structuredClone(base),stored={...structuredClone(base),body:'Concurrent prose'};
 delete mine.results;let plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,0);
 const merged=plan.resolve(new Map())[0];assert.equal(Object.hasOwn(merged,'results'),false);assert.equal(merged.body,'Concurrent prose');assert.ok(plan.summaries[0].local.includes('Conclusions, numbers and tables'));
 delete base.results;mine.body='New local prose';stored.results={version:1,statements:[]};stored.body='';plan=reconcileRecords([{base,record:mine}],[stored]);
 assert.equal(plan.conflicts.length,0);assert.deepEqual(plan.resolve(new Map())[0].results,stored.results);
});

test('section order recovery preserves neighbours and all independently added content',()=>{
 const section=id=>({id,title:id,body:'Source '+id}),record=sections=>({id:'record',title:'Long record',body:'',sections:sections.map(section),attachments:[],contributors:[],relations:[],figures:[],notebookId:'notebook',share:false});
 const base=record(['a','b','c','d']),mine=record(['b','a','c','local','d']),stored=record(['a','b','remote','c','d']);mine.sections[0].body='My b';stored.sections.at(-1).body='Saved d';
 let plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,0);let merged=plan.resolve(new Map())[0];
 assert.deepEqual(merged.sections.map(s=>s.id),['b','remote','a','c','local','d']);assert.equal(merged.sections[0].body,'My b');assert.equal(merged.sections.at(-1).body,'Saved d');
 stored.sections.reverse();plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,1);const conflict=plan.conflicts[0];assert.deepEqual(JSON.parse(conflict.key),['record','sections','order']);
 merged=plan.resolve(new Map([[conflict.key,conflict.stored]]))[0];assert.deepEqual(merged.sections.map(s=>s.id),['d','c','local','remote','b','a']);
});

test('thousands of independently changed sections reconcile without dropping late identities',t=>{
 const count=5000,sections=Array.from({length:count},(_,i)=>({id:'section-'+i,title:'Section '+i,body:'Original '+i}));
 const base={id:'record',title:'Many observations',body:'',sections,attachments:[],contributors:[],relations:[],figures:[],notebookId:'notebook',share:false},mine=structuredClone(base),stored=structuredClone(base);
 for(let i=0;i<count;i++)(i%2?mine:stored).sections[i].body='Changed '+i;
 const started=performance.now(),plan=reconcileRecords([{base,record:mine}],[stored]);assert.equal(plan.conflicts.length,0);const merged=plan.resolve(new Map())[0];
 assert.equal(merged.sections.length,count);for(let i=0;i<count;i++){assert.equal(merged.sections[i].id,sections[i].id);assert.equal(merged.sections[i].body,'Changed '+i);}
 t.diagnostic('Reconciled '+count+' independently changed sections in '+Math.round(performance.now()-started)+' ms.');
});

test('a conflict plan keeps stable versions and returns independently editable resolutions',()=>{
 const record=body=>({id:'record',title:'Run',body,sections:[],notebookId:'book',share:false}),base=record({text:'Original'}),mine=record({text:'Mine'}),stored=record({text:'Saved'});
 const plan=reconcileRecords([{base,record:mine}],[stored]),conflict=plan.conflicts[0];
 mine.body.text='Later editor change';stored.body.text='Later remote response';base.body.text='Caller mutation';
 const inspected=conflict.mine;inspected.text='Inspection mutation';
 assert.deepEqual(conflict.mine,{text:'Mine'});assert.deepEqual(conflict.base,{text:'Original'});
 const first=plan.resolveVersions(new Map([[conflict.key,{version:'mine'}]]))[0];first.body.text='Later resolved edit';
 const second=plan.resolveVersions(new Map([[conflict.key,{version:'stored'}]]))[0];assert.deepEqual(second.body,{text:'Saved'});
 assert.deepEqual(plan.resolveVersions(new Map([[conflict.key,{version:'mine'}]]))[0].body,{text:'Mine'});
 assert.throws(()=>plan.resolveVersions(new Map([[conflict.key,{version:'unknown'}]])),/Choose a version/);
 const combined={text:'Combined'};const result=plan.resolveVersions(new Map([[conflict.key,{version:'combined',value:combined}]]))[0];result.body.text='Edit combined result';assert.equal(combined.text,'Combined');
});

test('owned conflict planning borrows immutable evidence and copies only the selected resolution',()=>{
 const record=points=>({id:'record',title:'Run',body:'',sections:[],figures:[{id:'figure',series:[{points}]}],notebookId:'book',share:true});
 const base=record([{x:'1',y:'1/3'}]),mine=record([{x:'1',y:'2/3'}]),stored=record([{x:'1',y:'3/4'}]),clone=globalThis.structuredClone,copies=[];
 globalThis.structuredClone=value=>{copies.push(value);return clone(value);};
 try{
  const plan=reconcileRecords([{base,record:mine}],[stored],{owned:true});assert.equal(copies.length,0);assert.equal(plan.conflicts.length,1);
  assert.throws(()=>{mine.figures[0].series[0].points[0].y='Bad mutation';},TypeError);
  const conflict=plan.conflicts[0],result=plan.resolveVersions(new Map([[conflict.key,{version:'mine'}]]))[0];
  assert.equal(copies.length,1);assert.equal(result.figures[0].series[0].points[0].y,'2/3');assert.notEqual(result.figures,mine.figures);
 }finally{globalThis.structuredClone=clone;}
});

test('large conflict recovery does not duplicate serialized records while planning',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/reconcile-large-draft.js'],{cwd:process.cwd(),timeout:120000,windowsHide:true});
 const result=JSON.parse(stdout.trim());assert.equal(result.sections,480);assert.equal(result.conflicts,480);assert.ok(result.encodedBodyBytes>50*1024*1024);assert.ok(result.heapLimit<64*1024*1024);t.diagnostic(stdout.trim());
});
