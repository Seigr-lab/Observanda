import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Laboratory } from '../src/laboratory.js';
import { Workspace } from '../src/storage.js';
import { createNotebook } from '../src/model.js';
import { buildPublication } from '../src/publication.js';

const result = () => ({ method: 'Optical method v1', analyte: 'Absorbance', kind: 'numeric', value: 0.3, unit: 'AU', lower: 0, upper: 1, notes: 'Synthetic result\nSecond line' });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-lab-')), lab = new Laboratory(root);
  await new Workspace(root).create(createNotebook('Public research'));
  let current = await lab.read();
  const change = async data => (current = await lab.change({ ...data, etag: current.etag }));
  await change({ action: 'create-sample', sample: { code: 'S-001', material: 'Synthetic liquid', source: 'PRIVATE_SUBJECT_SENTINEL', collectedOn: '2026-09-25', receivedOn: '2026-09-26' } });
  const sampleId = current.lab.samples[0].id;
  await change({ action: 'create-analysis', analysis: { code: 'A-001', sampleId, result: result() } });
  return { root, lab, change, sampleId, id: current.lab.analyses[0].id, current: () => current };
}

test('sample to reviewed sheet, amendment, renewed review and archive preserves prior revisions', async () => {
  const s = await setup(), { id } = s;
  await assert.rejects(s.lab.report(id, s.current().etag), { code: 'LAB_TRANSITION' });
  await s.change({ action: 'submit', id });
  const draftEtag = s.current().etag;
  await s.change({ action: 'review', id, reviewer: 'Reviewer One', comment: 'Evidence checked.', decision: 'approve', checked: true });
  const approved = s.current();
  const html = await s.lab.report(id, approved.etag);
  assert.match(html, /0.3/); assert.match(html, /Reviewer One/); assert.match(html, /Within interval/);
  assert.ok(!html.includes(s.root));
  await assert.rejects(s.lab.change({ action: 'archive', id, etag: draftEtag }), { code: 'LAB_STALE' });
  await assert.rejects(s.change({ action: 'save-result', id, result: { ...result(), value: 0.7 } }), { code: 'LAB_TRANSITION' });
  await s.change({ action: 'amend', id, reason: 'Correct transcription.' });
  await assert.rejects(s.lab.report(id, approved.etag), { code: 'LAB_STALE' });
  assert.equal(s.current().lab.analyses[0].review, null);
  await s.change({ action: 'save-result', id, result: { ...result(), value: 1.5 } });
  await s.change({ action: 'submit', id });
  await s.change({ action: 'review', id, reviewer: 'Reviewer Two', comment: 'Correction checked.', decision: 'approve', checked: true });
  await s.change({ action: 'archive', id });
  assert.match(await s.lab.report(id, s.current().etag), /Above interval/);
  await assert.rejects(s.change({ action: 'amend', id, reason: 'Attempt archive edit' }), { code: 'LAB_TRANSITION' });
  const histories = await readdir(path.join(s.root, '.observanda', 'laboratory-history'));
  const old = JSON.parse(await readFile(path.join(s.root, '.observanda', 'laboratory-history', approved.etag + '.json')));
  assert.equal(old.analyses[0].result.value, 0.3); assert.ok(histories.length >= 8);
});

test('laboratory rejects duplicate identity, invalid units/intervals and incomplete review without mutation', async () => {
  const s = await setup(), original = s.current().etag;
  for (const r of [{ ...result(), unit: '' }, { ...result(), value: null }, { ...result(), lower: 3, upper: 2 }]) await assert.rejects(s.change({ action: 'save-result', id: s.id, result: r }), { code: 'LAB_INVALID' });
  const { id, ...sample } = s.current().lab.samples[0];
  await assert.rejects(s.change({ action: 'create-sample', sample }), { code: 'LAB_INVALID' });
  assert.equal((await s.lab.read()).etag, original);
  await s.change({ action: 'submit', id: s.id });
  await assert.rejects(s.change({ action: 'review', id: s.id, reviewer: 'R', comment: '', decision: 'approve', checked: false }), { code: 'LAB_TRANSITION' });
  await assert.rejects(s.change({ action: 'review', id: s.id, reviewer: 'R', comment: '', decision: 'reject', checked: true }), { code: 'LAB_TRANSITION' });
});

test('reviewed result tampering is rejected and private laboratory data never enters static output', async () => {
  const s = await setup(); await s.change({ action: 'submit', id: s.id });
  await s.change({ action: 'review', id: s.id, reviewer: 'R', comment: '', decision: 'approve', checked: true });
  const files = buildPublication((await new Workspace(s.root).read()).book).files;
  assert.ok(![...files.values()].join('').includes('PRIVATE_SUBJECT_SENTINEL'));
  const file = path.join(s.root, '.observanda', 'laboratory.json'), data = JSON.parse(await readFile(file));
  data.analyses[0].result.value = 77; await writeFile(file, JSON.stringify(data));
  await assert.rejects(s.lab.read(), { code: 'LAB_INVALID' });
});

test('save and submit is one revision; independent analysis edits do not invalidate each other',async()=>{
 const s=await setup(),initial=s.current(),revision=initial.recordRevisions[s.id];
 await s.change({action:'create-analysis',analysis:{code:'A-002',sampleId:s.sampleId,result:result()}});
 const second=s.current().lab.analyses.find(a=>a.id!==s.id),before=s.current().lab.revision;
 const submitted=await s.lab.change({action:'save-and-submit',id:s.id,result:{...result(),value:0.6},etag:initial.etag,expectedRecordRevision:revision});
 assert.equal(submitted.lab.revision,before+1);
 assert.equal(submitted.lab.analyses.find(a=>a.id===s.id).status,'in review');
 assert.equal(submitted.lab.analyses.find(a=>a.id===s.id).result.value,0.6);
 const edited=await s.lab.change({action:'save-result',id:second.id,result:{...result(),value:0.9},etag:initial.etag,expectedRecordRevision:s.current().recordRevisions[second.id]});
 assert.equal(edited.lab.analyses.find(a=>a.id===second.id).result.value,0.9);
 await assert.rejects(s.lab.change({action:'save-result',id:s.id,result:result(),etag:edited.etag,expectedRecordRevision:revision}),{code:'LAB_STALE'});
});
test('retained issued sheets bind the approved revision through later amendments',async()=>{
 const s=await setup();await s.change({action:'save-and-submit',id:s.id,result:result()});
 await s.change({action:'review',id:s.id,reviewer:'Local reviewer',comment:'Checked',decision:'approve',checked:true});
 const issued=s.current().etag,original=await s.lab.report(s.id,issued,[],{retained:true});
 await s.change({action:'amend',id:s.id,reason:'Recheck'});
 await s.change({action:'save-result',id:s.id,result:{...result(),value:0.9}});
 assert.equal(await s.lab.report(s.id,issued,[],{retained:true}),original);
 await assert.rejects(s.lab.report(s.id,s.current().etag,[],{retained:true}),{code:'LAB_TRANSITION'});
});
