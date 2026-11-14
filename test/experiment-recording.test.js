import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createRun} from '../src/web/record-workflow.js';
import {emptyAttempt,validAttempt} from '../src/web/attempt-model.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {queryRecords,recordQueryDocument,recordQueryMatcher} from '../src/web/record-query.js';
import {validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection} from '../src/publication.js';

// A complete physical experiment as a firmware lab notebook records it: a
// hypothesis and method, criteria declared before the run, two boots of one
// built image recorded as runs, measured bands in a table, raw captures with
// their hashes, outcomes in the author's words, and a reproduction command
// that stays private. Everything is recorded and found again, and only the
// shared parts reach the website.
const stamp='2026-09-16T15:30:59.000Z';
const fact=()=>({id:randomUUID(),supersedes:null,recordedAt:stamp,reason:''});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});
const bands=(title,rows)=>({type:'book_table',attrs:{version:1,id:randomUUID(),title,headers:['Identity','Frozen band (V)','Observed range (V)','Later matches'],rows}});
const imageHash=sha(Buffer.from('built image 1F805F632096'));

function boot(prep,{capture,matched}){
 const event=(kind,label,context,time)=>({...fact(),preparationId:prep.id,kind,label,extent:'complete',context,circumstances:'',actor:'Operator',source:'Installation and capture receipts',time,references:[]});
 return {
  events:[event('installed','Image written and read back in full','host',{meaning:'wall-clock',value:'2026-09-16 15:24'}),event('executing','Device powered and ran the calibration','physical',{meaning:'device-counter',value:'sequence 1 to 21'}),event('returned','Storage card returned with both records','physical',{meaning:'unknown',value:''}),event('acquired','Raw capture '+capture+' copied','host',{meaning:'wall-clock',value:'2026-09-16 15:30'})],
  assessments:prep.criteria.map(criterion=>({...fact(),preparationId:prep.id,criterionId:criterion.id,outcome:'met',domainOutcome:'passed',observed:criterion.label==='Recognition'?matched+' readings matched':'Six disjoint bands',denominator:criterion.denominator,actor:'Reviewer',source:'Independent recalculation on the computer',time:{meaning:'unknown',value:''},reason:'Recalculated from the raw capture against the frozen bands',references:[]}))
 };
}

test('a physical experiment with two boots, frozen criteria, raw captures and private steps is recorded, found and published safely',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-experiment-')),book=sampleNotebook();
 for(const e of book.entries){e.figures=[];e.attachments=[];e.relations=[];e.sections=[];e.share=false;}
 const [experiment,concept,previous]=book.entries;
 Object.assign(concept,{type:'note',title:'Voltage-based state recognition',share:true});Object.assign(previous,{type:'experiment',title:'Repeated electrical ranges',share:true});
 const link=(type,target)=>({id:randomUUID(),type,target:{workspaceId:book.id,kind:'record',id:target.id},label:target.title});
 experiment.relations=[link('Builds on',previous),link('Supports',concept)];
 Object.assign(experiment,{type:'experiment',title:'Startup calibration and target recognition',occurredOn:'2026-09-16',status:'completed',share:true,outcome:'Passed: 144/144 held-out readings across two boots',body:'Calibration at startup accommodates a measured shift between boots.'});
 experiment.sections=[
  {id:randomUUID(),title:'Hypothesis',share:true,body:{type:'doc',content:[paragraph('Calibration established during startup accommodates the shift observed between boots while keeping six identities apart.')]}},
  {id:randomUUID(),title:'Assessment criteria',share:true,body:{type:'doc',content:[paragraph('Six disjoint bands; 72/72 later readings match their requested identity; all eighteen restorations acknowledged.')]}},
  {id:randomUUID(),title:'Results',share:true,body:{type:'doc',content:[bands('First boot',[['0','0.7474498–0.7530615','0.7494498–0.7513302','12/12'],['5','0.8339455–0.8387514','0.8356769–0.8370199','12/12']])]}},
  {id:randomUUID(),title:'Reproduction on the lab computer',share:false,body:{type:'doc',content:[{type:'code_block',attrs:{language:'powershell',semanticRole:null},content:[{type:'text',text:'python -m tools.sd_report --capture C:/lab/private/report.bin'}]}]}}
 ];
 const encrypted=await encryptedFixture(root,book),ws=encrypted.workspace;
 t.after(async()=>{await clearVault(encrypted.vault);await rm(root,{recursive:true,force:true});});
 const records=new ResearchRecords(ws,{}),materials=new ResearchMaterials(ws);
 const save=async next=>{const current=(await ws.read()).book.entries.find(e=>e.id===next.id);return records.save({workspaceId:book.id,changes:[{id:next.id,expectedRevision:current?recordRevision(current):null,record:next}]});};

 // Criteria are declared before the boots; each boot is a run of the experiment.
 const preparation={...fact(),applicability:'Both boots of the unchanged image',basedOn:null,protocols:[],
  conditions:[{id:randomUUID(),name:'Band margin',value:'2',unit:'mV',basis:'stated',reference:null,reason:'Experiment tolerance'},{id:randomUUID(),name:'Maximum temperature',value:'35.631',unit:'°C',basis:'measured',reference:null,reason:''}],
  inputs:[{id:randomUUID(),label:'Built image 1F805F632096',kind:'image',algorithm:'sha256',hash:imageHash,reference:null}],
  observations:[{id:randomUUID(),label:'Six calibration readings per identity, then twelve recognition attempts'}],
  criteria:[{id:randomUUID(),label:'Calibration',expected:'Six disjoint bands',comparator:'Independent recalculation',denominator:'Six identities',scope:'prospective',reason:''},{id:randomUUID(),label:'Recognition',expected:'72/72',comparator:'Requested identity compared after classification',denominator:'72 later readings',scope:'prospective',reason:''}]};
 const runs=[];
 for(const [n,capture] of [[1,'sd-report-20260916-153059-579'],[2,'sd-report-20260916-153914-341']]){
  const run=createRun((await ws.read()).book,experiment);run.title='Boot '+n;run.share=true;run.outcome='Passed: 72/72';
  const result=boot(preparation,{capture,matched:'72/72'});
  run.attempt={...emptyAttempt(),preparations:[n===1?preparation:{...preparation,...fact(),basedOn:null}],...result};
  if(n===2){run.attempt.preparations[0].criteria=preparation.criteria;run.attempt.events.forEach(e=>{e.preparationId=run.attempt.preparations[0].id;});run.attempt.assessments.forEach(a=>{a.preparationId=run.attempt.preparations[0].id;});}
  assert.ok(validAttempt(run.attempt),'boot '+n+' facts are valid');
  await save(run);runs.push(run);
 }
 await save(experiment);

 // Raw captures and their analysis are kept byte for byte with their hashes.
 const capture=Buffer.alloc(8192,0x5a),analysis=Buffer.from(JSON.stringify({readings:72,matched:72,minimumMargin:'1.4628 mV'}));
 const upload=async(recordId,name,bytes)=>{const session=await materials.startImport({recordId,name,size:bytes.length,provenance:'Returned storage card',derivesFrom:[]});for(let i=0;i<Math.ceil(bytes.length/EVIDENCE_CHUNK);i++)await materials.appendImport(session.id,i,[bytes.subarray(i*EVIDENCE_CHUNK,(i+1)*EVIDENCE_CHUNK)]);return materials.finishImport(session.id);};
 const raw=await materials.read(await upload(runs[0].id,'report.bin',capture)),summary=await materials.read(await upload(runs[0].id,'analysis.json',analysis));
 assert.equal(raw.content.sha256,sha(capture));assert.equal(raw.content.size,8192);assert.equal(summary.content.sha256,sha(analysis));

 const saved=(await ws.read()).book;validateNotebook(saved);
 const stored=id=>saved.entries.find(e=>e.id===id);
 assert.equal(stored(runs[0].id).attempt.preparations[0].inputs[0].hash,imageHash);
 assert.deepEqual(stored(runs[1].id).attempt.assessments.map(a=>a.outcome),['met','met']);
 assert.equal(stored(experiment.id).sections[2].body.content[0].type,'book_table');

 // Found again by outcome, by an assessment's words and by the image's identity.
 const documents=saved.entries.map(recordQueryDocument);
 assert.deepEqual(queryRecords(documents,{browse:{outcome:'144/144'}}).map(e=>e.id),[experiment.id]);
 assert.equal(queryRecords(documents,{browse:{outcome:'72/72'}}).length,2);
 assert.ok(queryRecords(documents,{search:'built image 1f805f632096'}).length>=1);

 // Linked to the experiment it builds on and the concept it supports.
 assert.deepEqual(stored(experiment.id).relations.map(r=>r.type),['Builds on','Supports']);
 assert.deepEqual(saved.entries.map(recordQueryDocument).filter(recordQueryMatcher({relatedTo:{workspaceId:book.id,id:concept.id}})).map(e=>e.id),[experiment.id]);
 // The website receives the shared parts; the private reproduction never does.
 const projection=publicProjection(saved),published=projection.entries.find(e=>e.id===experiment.id);
 assert.deepEqual(published.sections.map(s=>s.title),['Hypothesis','Assessment criteria','Results']);
 const output=buildPublication(saved),html=[...output.files.values()].map(String).join('\n');
 assert.ok(html.includes('0.7474498–0.7530615'),'the band table is published');
 assert.ok(html.includes('Passed: 144/144'),'the outcome is published');
 assert.equal(html.includes('C:/lab/private'),false);assert.equal(html.includes('Reproduction on the lab computer'),false);
});
