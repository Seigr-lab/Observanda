import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ResearchMaterials} from '../../src/research-materials.js';

// Expectations come from authored commands and generated original bytes, not
// from the catalogue, backup inventory or the verifier under qualification.
export const recordFingerprint=record=>createHash('sha256').update(JSON.stringify(record,(_key,value)=>
 value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex');

export async function reconcileResearch(workspace,{records,originals,retained,rows}){
 const materials=new ResearchMaterials(workspace),seenRecords=new Set(),seenFiles=new Set();let originalBytes=0,rowCount=0;
 await workspace.catalogue(async store=>{
  const snapshot=await store.snapshot();
  for await(const member of store.members(snapshot)){
   assert.ok(records.has(member.id),'Unexpected current record '+member.id);
   assert.ok(!seenRecords.has(member.id),'Duplicate current record '+member.id);seenRecords.add(member.id);
   assert.equal(recordFingerprint(await store.record(member.id,member.revision)),records.get(member.id),'Record content or relationships changed: '+member.id);
  }
  assert.deepEqual(seenRecords,new Set(records.keys()));
  for await(const head of materials.headEntries()){
   if(head.kind!=='artifact')continue;
   const {doc,content}=await materials.artifact(head),expected=originals.get(doc.content.name);
   assert.ok(expected,'Unexpected original '+doc.content.name);assert.ok(!seenFiles.has(doc.content.name),'Duplicate original association');seenFiles.add(doc.content.name);
   assert.equal(doc.recordId,expected.recordId);assert.equal(doc.content.size,expected.size);assert.equal(doc.content.sha256,expected.sha256);
   const hash=createHash('sha256');let bytes=0;
   for await(const chunk of content.stream()){hash.update(chunk);bytes+=chunk.length;}
   assert.equal(bytes,expected.size);assert.equal(hash.digest('hex'),expected.sha256);originalBytes+=bytes;
  }
  assert.deepEqual(seenFiles,new Set(originals.keys()));
  for await(const row of materials.iterateDataset(retained.dataset)){
   assert.deepEqual(row.cells,[String(rowCount%4),'18446744073709551615','105','Synthetic acquired detail. '.repeat(165)]);
   rowCount++;
  }
  assert.equal(rowCount,rows);
  const calculation=await materials.read(retained.figure);
  assert.equal(calculation.content.denominator.included,rows);assert.equal(calculation.content.figure.series[0].points[0].y,1.5);
 });
 return {records:seenRecords.size,originals:seenFiles.size,originalBytes,rows:rowCount};
}
