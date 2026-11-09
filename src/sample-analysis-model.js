import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {sampleInterval} from './web/sample-result-numerics.js';
import {sampleScalarFields} from './web/sample-result-format.js';
import {validSampleSources} from './web/sample-result-references.js';
const text = (v, max = 500, required = true) => typeof v === 'string' && v.length <= max && (!required || v.trim()) && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => expected.includes(k)) && expected.every(k => Object.hasOwn(value, k));
const id = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const blank = () => ({ formatVersion: 1, revision: 0, samples: [], analyses: [], events: [] });
const fail = () => { throw new AppError('LAB_INVALID'); };

function validateSample(s) {
  if (!keys(s, ['id', 'code', 'material', 'source', 'collectedOn', 'receivedOn']) || !id(s.id) || !text(s.code, 80) || !text(s.material, 160) || !text(s.source, 160, false) || !date(s.collectedOn) || !date(s.receivedOn) || s.receivedOn < s.collectedOn) fail();
}
function validateResult(r) {
  const fields = ['method', 'analyte', 'kind', 'value', 'unit', 'lower', 'upper', 'notes'];
  if (r?.numericVersion === 2 && r.kind === 'numeric') fields.push('numericVersion');
  if (r?.provenance !== undefined) {
    if (!validSampleSources(r.provenance) || (r.provenance.reading && r.numericVersion !== 2)) fail();
    fields.push('provenance');
  }
  if (!keys(r, fields) || !text(r.method, 160) || !text(r.analyte, 160) || !['numeric', 'text'].includes(r.kind) || !text(r.unit, 80, false) || !text(r.notes, 2000, false)) fail();
  if (r.kind === 'text') {
    if (!text(r.value, 500) || r.lower !== null || r.upper !== null) fail();
  } else if ((!r.provenance?.reading && !text(r.unit, 80)) || sampleInterval(r).issue) fail();
}
export function resultFlag(r) {
  const {flag} = sampleInterval(r);
  if (!flag) fail();
  return {below: 'Below interval', above: 'Above interval', within: 'Within interval', noInterval: 'No interval specified'}[flag];
}
const resultHash = (a, sample) => digest(serialize({ code: a.code, sample, result: a.result }));
export function validateSampleAnalysisEvent(event,previous){
 if (!keys(event, ['id', 'at', 'action', 'recordId', 'actor', 'reason', 'previous', 'hash']) || !id(event.id) || !id(event.recordId) || !Number.isFinite(Date.parse(event.at)) || !text(event.action, 80) || !text(event.actor, 160, false) || !text(event.reason, 2000, false) || event.previous !== previous) fail();
 const {hash,...payload}=event;if(hash!==digest(serialize(payload)))fail();
}

export function validateLab(lab,{bounded=true}={}) {
  if (!keys(lab, ['formatVersion', 'revision', 'samples', 'analyses', 'events']) || lab.formatVersion !== 1 || !Number.isSafeInteger(lab.revision) || lab.revision < 0 || ![lab.samples, lab.analyses, lab.events].every(Array.isArray) || bounded&&(lab.samples.length > 5000 || lab.analyses.length > 10000 || lab.events.length > 50000)) fail();
  const ids = new Set(), codes = new Set();
  for (const s of lab.samples) { validateSample(s); if (ids.has(s.id) || codes.has(s.code.toLowerCase())) fail(); ids.add(s.id); codes.add(s.code.toLowerCase()); }
  const sampleIds = new Set(ids);
  codes.clear();
  for (const a of lab.analyses) {
    if (!keys(a, ['id', 'code', 'sampleId', 'result', 'status', 'review', 'updatedAt']) || !id(a.id) || ids.has(a.id) || !text(a.code, 80) || codes.has(a.code.toLowerCase()) || !sampleIds.has(a.sampleId) || !['draft', 'in review', 'approved', 'rejected', 'archived'].includes(a.status) || !Number.isFinite(Date.parse(a.updatedAt))) fail();
    ids.add(a.id); codes.add(a.code.toLowerCase()); validateResult(a.result);
    if (a.review !== null) {
      const r = a.review;
      if (!keys(r, ['reviewer', 'comment', 'at', 'decision', 'hash', 'sample']) || !text(r.reviewer, 160) || !text(r.comment, 2000, false) || !Number.isFinite(Date.parse(r.at)) || !['approve', 'reject'].includes(r.decision)) fail();
      validateSample(r.sample); if (r.sample.id !== a.sampleId || r.hash !== resultHash(a, r.sample)) fail();
    }
    if (['approved', 'archived'].includes(a.status) && a.review?.decision !== 'approve') fail();
    if (a.status === 'rejected' && a.review?.decision !== 'reject') fail();
    if (['draft', 'in review'].includes(a.status) && a.review !== null) fail();
  }
  let previous = '';
  for (const event of lab.events) {
    validateSampleAnalysisEvent(event,previous);if(!ids.has(event.recordId))fail();previous=event.hash;
  }
  if (bounded&&Buffer.byteLength(serialize(lab)) > 16 * 1024 * 1024) throw new AppError('LIMIT');
  return lab;
}


export function applySampleAnalysisCommand(data,{existing=null,sourceSample=null,now=new Date().toISOString()}={}){
      let record, actor = '', reason = '';
      if (data.action === 'create-sample') {
        if (!keys(data, ['etag', 'action', 'sample'])) fail();
        record = { ...data.sample, id: randomUUID() }; validateSample(record);
      } else if (data.action === 'create-analysis') {
        if (!keys(data, ['etag', 'action', 'analysis']) || !keys(data.analysis, ['code', 'sampleId', 'result'])) fail();
        record = { ...data.analysis, id: randomUUID(), status: 'draft', review: null, updatedAt: now };
      } else {
        record = existing ? structuredClone(existing) : null; if (!record) fail();
        if (data.action === 'save-result') {
          if (!keys(data, ['etag', 'action', 'id', 'result']) || record.status !== 'draft') throw new AppError('LAB_TRANSITION');
          validateResult(data.result); record.result = structuredClone(data.result);
        } else if (data.action === 'save-and-submit') {
          if (!keys(data,['etag','action','id','result'])||record.status!=='draft')throw new AppError('LAB_TRANSITION');
          validateResult(data.result);record.result=structuredClone(data.result);record.status='in review';
        } else if (data.action === 'submit') {
          if (!keys(data, ['etag', 'action', 'id']) || record.status !== 'draft') throw new AppError('LAB_TRANSITION');
          record.status = 'in review';
        } else if (data.action === 'review') {
          if (!keys(data, ['etag', 'action', 'id', 'reviewer', 'comment', 'decision', 'checked']) || record.status !== 'in review' || !text(data.reviewer, 160) || !text(data.comment, 2000, false) || !['approve', 'reject'].includes(data.decision) || data.checked !== true || (data.decision === 'reject' && !data.comment.trim())) throw new AppError('LAB_TRANSITION');
          const sample = structuredClone(sourceSample);
          actor = data.reviewer; reason = data.comment;
          record.review = { reviewer: actor, comment: reason, decision: data.decision, at: now, sample, hash: resultHash(record, sample) };
          record.status = data.decision === 'approve' ? 'approved' : 'rejected';
        } else if (data.action === 'amend') {
          if (!keys(data, ['etag', 'action', 'id', 'reason']) || !['in review', 'approved', 'rejected'].includes(record.status) || !text(data.reason, 2000)) throw new AppError('LAB_TRANSITION');
          reason = data.reason; record.review = null; record.status = 'draft';
        } else if (data.action === 'archive') {
          if (!keys(data, ['etag', 'action', 'id']) || record.status !== 'approved') throw new AppError('LAB_TRANSITION');
          record.status = 'archived';
        } else fail();
        record.updatedAt = now;
      }

 const proposed=data.result??data.analysis?.result;
 if(proposed?.kind==='numeric'){
  const prior=existing?.result;
  if(proposed.numericVersion===undefined && (prior?.kind!=='numeric' || prior.numericVersion!==undefined ||
      sampleScalarFields.some(key=>proposed[key]!==prior[key])))fail();
  if(sampleScalarFields.some(key=>typeof proposed[key]==='number' && proposed[key]!==prior?.[key]))fail();
 }
 validateLab({formatVersion:1,revision:0,samples:data.action==='create-sample'?[record]:sourceSample?[sourceSample]:[],analyses:data.action==='create-sample'?[]:[record],events:[]});
 return {record,actor,reason};
}
