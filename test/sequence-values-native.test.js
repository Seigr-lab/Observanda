import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDomain,knownDomain} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {domainValuePage,readDomainComponent,domainValuesEqual} from '../src/measurement-domain-storage.js';
import {catalogueFormat,configurationCatalogueFeatures,configurationCatalogueGeneration,catalogueRequiresSequenceValues} from '../src/catalogue-format.js';
import {verifiedCatalogueObjects} from '../src/catalogue-object-verification.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset} from '../src/dataset-jobs.js';
import {retainedTable} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';

const flags=['sequenceValues','nativeDomainValues','nativeNumericalModels','tensorValues','computedCells','calculationPolicies','structuredCalculator','approximateCalculator','measurementScalarPolicies','datasetResourcePolicies'];
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const locator=(ref,row=0,column=0)=>({ref,selector:{kind:'cell',page:0,row,column}});

// Every phase verifies the same pinned source/result generations. No private
// workspace is opened; the entire encrypted fixture is removed after the run.
test('variable-length numerical and symbolic sequences retain exact operations, publication and complete recovery',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-sequence-values-')),vaults=[];
 const provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let jobs,retainedCheck;
 t.after(async()=>{await jobs?.worker.stop();await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-sequence-values-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const started=Date.now(),stage=message=>process.stdout.write('# ['+((Date.now()-started)/1000).toFixed(3)+'s] '+message+'\n'),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:1000000,maxMilliseconds:30000});vaults.push(f.vault);jobs=workspaceJobs(f.workspace);
 await t.test('explicit sequence intake, all five operations, pinned job retry and full publication',{timeout:300000},async phase=>{
  const request=(operation,data)=>executeMaterialRequest(f.workspace,{material:operation},data,{signal:phase.signal});
  const upload=async(name,text)=>{const bytes=Buffer.from(text),session=await m.startImport({recordId,name,size:bytes.length});await m.appendImport(session.id,0,[bytes]);return m.finishImport(session.id);};
  const leased=async(job,operation)=>{let pulse=Promise.resolve(),failure;const heartbeat=setInterval(()=>{pulse=pulse.then(()=>jobs.queue.pulse(job.id,job.lease.token)).catch(error=>{failure=error;});},jobs.queue.leaseMs/3);try{const result=await operation();await pulse;if(failure)throw failure;return result;}finally{clearInterval(heartbeat);await pulse;}};
  const opaque=version=>({...defaultDomain('vector'),version,codec:'observanda.sequence',namespace:'Legacy opaque sequence label',...(version===2?{resourcePolicy:policy}:{})});
  const oldSource=await m.dataset({recordId,title:'Opaque older sequence codec names',artifact:await upload('opaque-sequence.csv','Old1,Old2\n"not JSON; old value one","not JSON; old value two"'),columns:[1,2].map(version=>({...defaultColumn({label:'Old '+version}),representation:'domain',domain:opaque(version)}))});assert.equal(catalogueRequiresSequenceValues(await f.workspace.catalogue(store=>catalogueFormat(store.db))),false);
  const longNumeric='0'.repeat(4200)+'10',longSymbol='L'.repeat(4201)+'<symbol & end>',numericDefinition={...defaultDomain('sequence'),namespace:'Exact ordered senary observations',element:{kind:'numeric',representation:'radix-fraction',radix:6},resourcePolicy:policy},symbolDefinition={...defaultDomain('sequence'),namespace:'Authored ordered labels',element:{kind:'symbol'},resourcePolicy:policy};
  const columns=[['Numerical sequence',numericDefinition],['Numerical suffix',numericDefinition],['Symbol sequence',symbolDefinition],['Empty sequence',numericDefinition]].map(([label,domain])=>({...defaultColumn({label}),representation:'domain',domain:structuredClone(domain)}));
  const inputRows=[[['010',null,longNumeric],['0.1'],['',null,longSymbol],[]],[['11'],[],[null,'tail'],[]]],csv=rows=>'A,B,S,E\n'+rows.map(row=>row.map(value=>quote(JSON.stringify(value))).join(',')).join('\n'),artifact=await upload('ordered-sequences.csv',csv(inputRows)),source=await m.dataset({recordId,title:'Variable-count retained sequences',artifact,columns});
  let graph=(await request('calculation-graph-create',{recordId,title:'Explicit sequence operations',source,graphVersion:14,policy})).ref;const legacy=graph,bindingValue=(await request('calculation-graph-page',{ref:graph,collection:'bindings'})).items[0],binding={id:bindingValue.id,position:0},nodes=[];
  const firstNode={id:randomUUID(),kind:'column',binding,column:0};await assert.rejects(request('calculation-graph-change',{ref:graph,collection:'nodes',offset:0,item:firstNode}),{code:'DATASET_CALCULATION'});assert.equal((await m.current(graph.id)).revision,graph.revision);graph=(await request('calculation-graph-change',{ref:graph,collection:'version',graphVersion:15,policy})).ref;
  const address=position=>({id:nodes[position].id,position}),add=async value=>{const item={id:randomUUID(),...value};graph=(await request('calculation-graph-change',{ref:graph,collection:'nodes',offset:nodes.length,item})).ref;nodes.push(item);return address(nodes.length-1);};
  for(let column=0;column<4;column++)await add({kind:'column',binding,column});
  const sequence=async(kind,left,extra={},right=null)=>add({kind:'domain-sequence',left:address(left),right:right===null?null:address(right),operation:{kind,...extra}});
  await sequence('length',0);await sequence('index',0,{index:0});await sequence('slice',0,{start:0,count:1});await sequence('concatenate',0,{},1);await sequence('reverse',0);await sequence('index',2,{index:0});await sequence('reverse',2);await sequence('length',3);await sequence('reverse',3);await sequence('slice',0,{start:1,count:0});
  const unchanged=graph;await assert.rejects(sequence('index',0,{index:-1}),{code:'DATASET_CALCULATION'});assert.equal((await m.current(graph.id)).revision,unchanged.revision);await assert.rejects(sequence('concatenate',0,{},2),{code:'MEASUREMENT_SEQUENCE_INCOMPATIBLE'});assert.equal((await m.current(graph.id)).revision,unchanged.revision);
  const selected=[4,5,6,7,8,9,10,11,12,13],names=['Length','Selected numerical element','Prefix','Concatenated','Reversed numerical','Selected symbol','Reversed symbols','Empty length','Reversed empty','Empty slice'];
  for(const [offset,position]of selected.entries())graph=(await request('calculation-graph-change',{ref:graph,collection:'outputs',offset,item:{id:randomUUID(),name:names[offset],node:address(position)}})).ref;
  const pinnedGraph=graph,command={recordId,title:'Retained exact sequence operations',calculation:{version:18,graph:pinnedGraph}},jobId=randomUUID();await enqueueDataset(m,jobs.queue,command,jobId);
  const changedRows=structuredClone(inputRows);changedRows[0][0][0]='12';const amendedSource=await m.dataset({recordId,title:'Explicit amended source sequence',id:source.id,expectedRevision:source.revision,artifact:await upload('amended-sequences.csv',csv(changedRows)),columns});assert.notEqual(amendedSource.revision,source.revision);
  let job=await jobs.queue.claim();assert.deepEqual(job.input.command.calculation,command.calculation);const prepared=await leased(job,()=>jobs.queue.definition(job).prepare(job,{signal:phase.signal}));await jobs.queue.control(jobId,'cancel');await assert.rejects(jobs.queue.complete(jobId,job.lease.token,prepared),{code:'JOB_CANCELLED'});await jobs.queue.release(jobId,job.lease.token);await jobs.queue.control(jobId,'retry');job=await jobs.queue.claim();const repeated=await leased(job,()=>jobs.queue.definition(job).prepare(job,{signal:phase.signal}));assert.deepEqual(repeated.content,prepared.content);const result=(await jobs.queue.complete(jobId,job.lease.token,repeated)).result;
  const originalColumn=await m.datasetColumn(await m.read(result),4),copied=await m.dataset({recordId,title:'Renamed retained sequence result',id:result.id,expectedRevision:result.revision,artifact:pinnedGraph,baseDataset:result,columnChanges:[{index:4,column:{...originalColumn,name:'Reversed sequence (display label)'}}]});
  const values=async(materials,value)=>(await domainValuePage(materials,value,{offset:0,limit:32,resolve:true})).items.map(item=>item.spelling);
  const check=async (materials,{signal}={})=>{signal?.throwIfAborted();
   for(const reference of [result,copied]){signal?.throwIfAborted();
    const doc=await materials.read(reference),page=await materials.datasetPage(reference);assert.equal(doc.content.algorithmVersion,17);assert.deepEqual(doc.content.calculation,command.calculation);assert.equal(doc.content.sequenceValues,1);assert.equal(page.rows.length,2);
    for(let row=0;row<2;row++){signal?.throwIfAborted();
     const cells=page.rows[row].cells,numeric=inputRows[row][0],suffix=inputRows[row][1],symbols=inputRows[row][2];assert.equal(cells[0],String(numeric.length));assert.equal(cells[1],numeric[0]);assert.equal(cells[7],'0');assert.equal(page.rows[row].excluded,null);
     for(const [column,expected]of [[2,numeric.slice(0,1)],[3,[...numeric,...suffix]],[4,[...numeric].reverse()],[6,[...symbols].reverse()],[8,[]],[9,[]]]){assert.equal(cells[column].version,5);assert.equal(cells[column].count,expected.length);assert.equal(cells[column].definition.shape,undefined);assert.deepEqual(await values(materials,cells[column]),expected);}
     if(row===0){assert.equal(cells[5].definition.codec,'observanda.symbol');assert.equal(cells[5].definition.namespace,symbolDefinition.namespace);assert.equal((await materials.readDatasetCell(cells[5])).text,'');assert.equal(page.rows[row].valueKinds[5],'string');}else assert.equal(page.rows[row].valueKinds[5],'null');
    }
    const numericColumn=await materials.datasetColumn(doc,1),sequenceColumn=await materials.datasetColumn(doc,4);assert.equal(numericColumn.representation,'radix-fraction');assert.equal(numericColumn.radix,6);assert.deepEqual(sequenceColumn.domain,numericDefinition);
    const selected=await readDomainComponent(materials,page.rows[0].cells[4],{component:0,offset:4199,limit:3});assert.equal(selected.text,'010');assert.equal(selected.next,null);const text=await readDomainComponent(materials,page.rows[0].cells[6],{component:0,offset:4200,limit:32});assert.equal(text.text,'L<symbol & end>');assert.equal(text.next,null);
   }
   const sourcePage=await materials.datasetPage(source),amendedPage=await materials.datasetPage(amendedSource);assert.equal((await values(materials,sourcePage.rows[0].cells[0]))[0],'010');assert.equal((await values(materials,amendedPage.rows[0].cells[0]))[0],'12');assert.equal(domainValuesEqual(materials,sourcePage.rows[0].cells[0],sourcePage.rows[0].cells[0]),null);
   const inspected=await materials.measurements.inspect(locator(result,0,3));assert.equal(inspected.domain.total,4);assert.ok(inspected.lineage.items.length>=2);const provenance=inspected.lineage.items.flatMap(item=>item.sources);for(const column of [0,1])assert.ok(provenance.some(item=>item.ref.id===source.id&&item.ref.revision===source.revision&&item.selector.kind==='cell'&&item.selector.page===0&&item.selector.row===0&&item.selector.column===column),'Missing pinned concatenation operand');assert.equal((await materials.read(legacy)).content.graphVersion,14);
   for(const cell of (await materials.datasetPage(oldSource)).rows[0].cells){assert.equal(knownDomain(cell.definition),false);assert.equal((await domainValuePage(materials,cell)).supported,false);assert.equal(cell.components,null);assert.equal((await materials.readDatasetCell(cell)).text.startsWith('not JSON'),true);}
  };await check(m,{signal:phase.signal});stage('Variable counts, all exact operations, explicit upgrade/refusals, pinned retry, null/empty selection, long component pages and lineage passed.');
  const table=await retainedTable(m,{ref:result,selection:{columns:'all',offset:0,count:null,includeExcluded:true},version:3});let html='';for await(const text of retainedTableHTML(m,{source:result,table},{signal:phase.signal}))html+=text;
  for(const text of [longNumeric,'L'.repeat(4201)+'&lt;symbol &amp; end&gt;','Exact ordered senary observations','Authored ordered labels'])assert.ok(html.includes(text),'Missing full public sequence value or meaning: '+text.slice(0,48));assert.ok(!html.includes('<symbol & end>'));for(const ref of [source,amendedSource,pinnedGraph,result])assert.ok(!html.includes(ref.id),'Private material identity must not be published');
  for(const name of flags){const generation=await f.workspace.catalogue(store=>catalogueFormat(store.db)),features=configurationCatalogueFeatures(generation);assert.equal(features[name],true,name+' admitted');delete features[name];await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE catalogue_format SET version=$1',configurationCatalogueGeneration(features))));try{await assert.rejects(m.read(result),{code:'CATALOGUE_DAMAGED'},name);if(name==='sequenceValues')await assert.rejects(f.workspace.catalogue(async store=>{for await(const value of verifiedCatalogueObjects(store))void value;}),{code:'CATALOGUE_DAMAGED'});}finally{await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE catalogue_format SET version=$1',generation)));}}
  retainedCheck=check;stage('Complete public numeric/symbol text, escaping/privacy and independent catalogue refusals passed.');
 });
 if(!retainedCheck)return;let originalVerified=false;
 await t.test('full original verification and reopened sequence generations',{timeout:300000},async phase=>{stage('Starting complete original verification.');await f.workspace.withLock(()=>m.verifySnapshot({signal:phase.signal}));await retainedCheck(new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),{signal:phase.signal});originalVerified=true;stage('Complete original verification and reopened retained values passed.');});
 if(!originalVerified)return;
 await t.test('whole encrypted copy, complete fresh-key verification and retained sequence closure',{timeout:300000},async phase=>{phase.signal.throwIfAborted();const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(directory,'fresh-device')})),fresh=takeCreatedVault(access);vaults.push(fresh);stage('Starting whole encrypted fresh-key copy.');const target=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'recovered'),{vault:f.vault,onProgress:()=>phase.signal.throwIfAborted()}),access,fresh,f.vault,{onProgress:()=>phase.signal.throwIfAborted()}),recovered=new ResearchMaterials(new Workspace(target,fresh));stage('Whole copy passed; starting complete recovered verification.');await recovered.workspace.withLock(()=>recovered.verifySnapshot({signal:phase.signal}));await retainedCheck(recovered,{signal:phase.signal});const features=configurationCatalogueFeatures(await recovered.workspace.catalogue(store=>catalogueFormat(store.db)));for(const name of flags)assert.equal(features[name],true,name+' recovered');stage('Full recovered verification, all exact generations, lineage and long-text closure passed.');});
});
