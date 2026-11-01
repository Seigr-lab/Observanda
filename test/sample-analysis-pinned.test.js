import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {sampleAnalysisCollection} from '../src/sample-analysis-collection.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {clearVault} from '../src/encryption.js';
import {queryCacheMemoryFiles} from './fixtures/query-cache-memory.js';
test('sample collection continuations and discovery reuse exact summaries while counts and pinned identities stay direct',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const owners=[1000,10000].map(count=>{
  const workspaceId=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)},storage=new Workspace(path.resolve('synthetic-sample-query',workspaceId),vault),address={workspaceId,projectId:null,labBookId:null},metadata={id:workspaceId,title:'Workspace',projects:[],notebooks:[]},rows=Array.from({length:count},(_,i)=>({id:randomUUID(),code:'Analysis '+i,sampleId:randomUUID(),sampleCode:'Sample '+i,status:'draft',updatedAt:'2026-01-01T00:00:00.000Z',result:{method:'Method',analyte:'Value',kind:'numeric',value:i,unit:'AU',lower:null,upper:null}}));storage.outline=async()=>({metadata});
  const source={etag:'a'.repeat(64),head:{counts:{samples:count,analyses:count,review:0,archive:0,approved:0,events:0}}},members=rows.map((summary,position)=>({id:summary.id,kind:'analysis',position,summary})),byId=new Map(members.map(row=>[row.id,row])),owner=Object.create(SampleAnalysisCatalogue.prototype),stats={values:0,scans:0,member:0};
  owner.range=async()=>({lower:0,upper:count,total:count});owner.value=async id=>{stats.values++;return byId.get(id);};owner.member=async(_head,_kind,id)=>{stats.member++;return byId.get(id);};owner.index={async *entries(_head,prefix){stats.scans++;for(const member of members)yield {id:owner.keys(member).find(key=>key.startsWith(prefix)),revision:member.id};},entryAt:async(_head,at)=>({id:owner.keys(members[at]).find(key=>key.startsWith('list:all:')),revision:members[at].id})};
  return {workspaceId,storage,address,rows,source,owner,stats};
 });
 t.mock.method(SampleAnalysisReader.prototype,'indexed',async function(id,_etag,operation){const value=owners.find(owner=>owner.workspaceId===id);assert.equal(this.laboratory.workspace,value.storage);return operation(value.owner,value.source);});
 const pages=new RecordCollectionPages(),client={},base={workspaceId:owners[0].workspaceId,view:'all',config:defaultPanelConfig(),options:{},mode:'page',key:null,cursor:null,offset:0,limit:25},visit=async(operation,{namespaces}={})=>{for(const owner of owners)if(!namespaces||namespaces.has(owner.workspaceId))await operation(owner.storage,owner.address);},read=patch=>sampleAnalysisCollection(pages,client,{...base,...patch},{visit}),reset=()=>owners.forEach(owner=>Object.keys(owner.stats).forEach(key=>owner.stats[key]=0));
 const expected=owners.flatMap(owner=>owner.rows.map(row=>({...row,collectionKey:owner.workspaceId+'/'+row.id,owner:{...owner.address,projectTitle:'Workspace',notebookTitle:''}}))).sort((a,b)=>a.owner.workspaceId<b.owner.workspaceId?-1:a.owner.workspaceId>b.owner.workspaceId?1:a.id<b.id?-1:a.id>b.id?1:0);
 try{
  const first=await read();assert.deepEqual(first.items,expected.slice(0,25));assert.equal(first.total,11000);assert.deepEqual(owners.map(owner=>owner.stats.values),[1000,10000]);reset();
  const second=await read({cursor:first.nextCursor});assert.deepEqual(second.items,expected.slice(25,50));assert.deepEqual((await read({cursor:second.previousCursor})).items,first.items);assert.deepEqual(owners.map(owner=>owner.stats.values),[0,0]);
  const counts=await read({mode:'counts'});assert.equal(counts.counts.analyses,11000);assert.deepEqual(owners.map(owner=>owner.stats.values),[0,0]);assert.deepEqual(owners.map(owner=>owner.stats.scans),[0,0]);
  assert.deepEqual((await read({key:first.items[0].collectionKey})).items,[first.items[0]]);assert.equal(owners.reduce((n,owner)=>n+owner.stats.member,0),1);
  const expectedDiscovery=owners.flatMap(owner=>owner.rows.map(row=>({...row,collectionKey:owner.workspaceId+'/'+row.id,owner:{...owner.address,projectTitle:'Workspace',notebookTitle:''}})));assert.deepEqual((await read({mode:'discovery'})).items,expectedDiscovery.slice(0,25));reset();
  assert.deepEqual((await read({mode:'discovery',offset:995})).items,expectedDiscovery.slice(995,1020));assert.deepEqual(owners.map(owner=>owner.stats.values),[0,0]);assert.deepEqual((await read({mode:'discovery',offset:15000})).items,[]);
  owners[0].source.etag='b'.repeat(64);await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  t.diagnostic(JSON.stringify({analysesPerOwner:[1000,10000],page:25,continuedSummaryReads:0,continuedDiscoveryReads:0,countOnlySummaryReads:0}));
 }finally{pages.clear();await Promise.all(owners.map(owner=>clearVault(owner.storage.vault)));}
});
