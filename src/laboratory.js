import {sampleAnalysisDomain,sampleAnalysisTransaction} from './sample-analysis-storage.js';
import path from 'node:path';
import {hasCatalogue} from './postgres.js';
import {ENCRYPTION_OVERHEAD} from './encryption.js';
import { randomUUID } from 'node:crypto';
import { Workspace, assertRegular, privateDirectory, digest, serialize } from './storage.js';
import { AppError } from './errors.js';
import { escapeHTML } from './publication.js';
import { assertPublicFields } from './privacy.js';
import {SampleAnalysisCatalogue} from './sample-analysis-catalogue.js';

import {blank,validateLab,applySampleAnalysisCommand} from './sample-analysis-model.js';
export {resultFlag} from './sample-analysis-model.js';
import {resultFlag} from './sample-analysis-model.js';
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const fail=()=>{throw new AppError('LAB_INVALID');};
const recordRevisions=lab=>Object.fromEntries([...lab.samples,...lab.analyses].map(record=>[record.id,digest(serialize(record))]));

export class Laboratory {
  constructor(root, vault = null) { this.workspace = root instanceof Workspace?root:new Workspace(root,vault); this.file = path.join(this.workspace.root, '.observanda', 'laboratory.json'); }
  async catalogue(operation,options={}){
    const namespaceId=await sampleAnalysisDomain(this.workspace);
    return namespaceId===null?this.workspace.catalogue(operation):sampleAnalysisTransaction(this.workspace,namespaceId,operation,options);
  }
  async read({revisions=true}={}) {
    if(await hasCatalogue(this.workspace.root))return this.catalogue(async store=>{
      const owner=new SampleAnalysisCatalogue(store),source=await owner.source();
      if(source){const lab=await owner.assemble(source);return {lab,etag:source.etag,recordRevisions:revisions?recordRevisions(lab):{}};}
      const lab=await store.object('laboratory');return {lab:validateLab(lab),etag:digest(serialize(lab)),recordRevisions:revisions?recordRevisions(lab):{}};
    });
    try {
      await assertRegular(path.dirname(this.file), { directory: true });
      const stat = await assertRegular(this.file); if (stat.size > 16 * 1024 * 1024 + ENCRYPTION_OVERHEAD) throw new AppError('LIMIT');
      const bytes = await this.workspace.readFile(this.file, 'utf8'); const lab=validateLab(JSON.parse(bytes));return {lab,etag:digest(bytes),recordRevisions:revisions?recordRevisions(lab):{}};
    } catch (error) { if (error.code === 'ENOENT') return { lab: blank(), etag: 'new',recordRevisions:{} }; throw error; }
  }
  async change(command,{compact=false,commandId=null,signal,check}={}) {
    if(commandId!==null&&!id(commandId))fail();
    const domain=await sampleAnalysisDomain(this.workspace);
    if(domain!==null)return sampleAnalysisTransaction(this.workspace,domain,async store=>{
      const fingerprint=digest(serialize(command)),receipt=commandId?await store.object('laboratory-command/'+commandId):null,owner=new SampleAnalysisCatalogue(store),source=await owner.source();
      if(!source)throw new AppError('CATALOGUE_DAMAGED');
      let result;
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new AppError('LAB_STALE');result=receipt.result;}
      else{
        result=await owner.change(source,commandId&&['create-sample','create-analysis'].includes(command.action)?{...command,etag:source.etag}:command);
        if(commandId)await store.putObject('laboratory-command/'+commandId,{fingerprint,result});
      }
      if(compact)return result;
      const current=await owner.source(),lab=await owner.assemble(current);return {lab,etag:current.etag,recordRevisions:recordRevisions(lab),selectedId:result.selectedId};
    },{write:true,signal,check});
    const {expectedRecordRevision,...data}=command;
    return this.workspace.withLock(async () => {
      const indexed=await hasCatalogue(this.workspace.root),fingerprint=digest(serialize(command));
      if(commandId){
        if(!indexed)fail();
        const receipt=await this.catalogue(store=>store.object('laboratory-command/'+commandId));
        if(receipt){if(receipt.fingerprint!==fingerprint)throw new AppError('LAB_STALE');return compact?receipt.result:{...await this.read(),selectedId:receipt.result.selectedId};}
      }
      if(indexed){
        const result=await this.catalogue(async store=>{
          const owner=new SampleAnalysisCatalogue(store),source=await owner.source();if(!source)return null;
          const next=commandId&&['create-sample','create-analysis'].includes(command.action)?{...command,etag:source.etag}:command;
          const result=await owner.change(source,next);
          if(commandId)await store.putObject('laboratory-command/'+commandId,{fingerprint,result});return result;
        });
        if(result)return compact?result:{...await this.read(),selectedId:result.selectedId};
      }
      const current = await this.read();
      if(expectedRecordRevision!==undefined){
        if(!id(data.id)||typeof expectedRecordRevision!=='string'||!/^[a-f0-9]{64}$/.test(expectedRecordRevision)||current.recordRevisions[data.id]!==expectedRecordRevision)throw new AppError('LAB_STALE');
      }else if (data.etag !== current.etag&&!(commandId&&['create-sample','create-analysis'].includes(data.action))) throw new AppError('LAB_STALE');
      const lab = structuredClone(current.lab), now = new Date().toISOString();
      const existing=lab.analyses.find(a=>a.id===data.id),sourceSample=lab.samples.find(s=>s.id===(data.analysis?.sampleId??existing?.sampleId));
      const {record,actor,reason}=applySampleAnalysisCommand(data,{existing,sourceSample,now});
      if(data.action==='create-sample')lab.samples.push(record);else if(data.action==='create-analysis')lab.analyses.push(record);else lab.analyses[lab.analyses.findIndex(a=>a.id===record.id)]=record;
      const event = { id: randomUUID(), at: now, action: data.action, recordId: record.id, actor, reason, previous: lab.events.at(-1)?.hash ?? '' };
      lab.events.push({ ...event, hash: digest(serialize(event)) }); lab.revision++;
      validateLab(lab);
      if(indexed){
        const result={etag:digest(serialize(lab)),selectedId:record.id,recordRevision:digest(serialize(record))};
        await this.catalogue(async store=>{
          if(current.etag!=='new')await store.putObject('laboratory-history/'+current.etag,current.lab);
          await store.putObject('laboratory',lab);
          if(commandId)await store.putObject('laboratory-command/'+commandId,{fingerprint,result});
        });
        return compact?result:{...await this.read(),selectedId:record.id};
      }
      if (current.etag !== 'new') {
        const revisions = await privateDirectory(this.workspace.root, '.observanda/laboratory-history');
        const snapshot = path.join(revisions, current.etag + '.json');
        const original = await this.workspace.readFile(this.file, 'utf8');
        if (digest(original) !== current.etag) throw new AppError('LAB_STALE');
        if (!(await assertRegular(snapshot, { missing: true }))) await this.workspace.writeFile(snapshot, original);
      }
      if ((await this.read()).etag !== current.etag) throw new AppError('LAB_STALE');
      await this.workspace.writeFile(this.file, serialize(lab));
      return compact?{etag:digest(serialize(lab)),selectedId:record.id,recordRevision:digest(serialize(record))}:{ ...(await this.read()), selectedId: record.id };
    });
  }
  async snapshot(expectedEtag=null,{retained=true}={}) {
    if(await hasCatalogue(this.workspace.root)){
      const found=await this.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store),source=await owner.source(expectedEtag,{retained});return source?{lab:await owner.assemble(source),etag:source.etag}:null;});
      if(found)return found;
    }
    let current = await this.read({revisions:false});
    if (expectedEtag !== null && expectedEtag !== current.etag) {
      if(retained&&expectedEtag==='new')return {lab:blank(),etag:'new',recordRevisions:{}};
      if(!retained||typeof expectedEtag!=='string'||!/^[a-f0-9]{64}$/.test(expectedEtag))throw new AppError('LAB_STALE');
      if(await hasCatalogue(this.workspace.root)){
        const lab=await this.catalogue(store=>store.object('laboratory-history/'+expectedEtag));
        if(!lab)throw new AppError('NOT_FOUND');if(digest(serialize(lab))!==expectedEtag)throw new AppError('LAB_INVALID');
        current={lab:validateLab(lab),etag:expectedEtag};
      }else{
      const directory=path.join(this.workspace.root,'.observanda','laboratory-history');
      await assertRegular(directory,{directory:true});
      const file=path.join(directory,expectedEtag+'.json'),stat=await assertRegular(file,{missing:true});
      if(!stat)throw new AppError('NOT_FOUND');if(stat.size>16*1024*1024+ENCRYPTION_OVERHEAD)throw new AppError('LIMIT');
      const bytes=await this.workspace.readFile(file,'utf8');if(digest(bytes)!==expectedEtag)throw new AppError('LAB_INVALID');
      current={lab:validateLab(JSON.parse(bytes)),etag:expectedEtag};
      }
    }
    return current;
  }
  async report(id, expectedEtag, blockedValues = [], {retained=false}={}) {
    const selected=await hasCatalogue(this.workspace.root)?await this.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store),source=await owner.source(expectedEtag,{retained});return source?{analysis:(await owner.selected(source,'analysis',id)).record,revision:source.head.revision}:null;}):null;
    const current=selected?null:await this.snapshot(expectedEtag,{retained});
    const a = selected?.analysis??current.lab.analyses.find(item => item.id === id);
    if (!a || !['approved', 'archived'].includes(a.status)) throw new AppError('LAB_TRANSITION');
    assertPublicFields([{ field: 'result sheet', value: JSON.stringify(a) }], blockedValues);
    const esc = escapeHTML, s = a.review.sample, r = a.result;
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Result sheet ${esc(a.code)}</title><link rel="stylesheet" href="/report.css"><main><p>Observanda / Laboratory results</p><h1>Result sheet</h1><p>Analysis <strong>${esc(a.code)}</strong> &middot; ${esc(a.status)}</p><dl><dt>Sample</dt><dd>${esc(s.code)}</dd><dt>Material</dt><dd>${esc(s.material)}</dd><dt>Source reference</dt><dd>${esc(s.source || 'Not specified')}</dd><dt>Collected / received</dt><dd>${s.collectedOn} / ${s.receivedOn}</dd><dt>Method and version</dt><dd>${esc(r.method)}</dd></dl><table><thead><tr><th>Analyte</th><th>Result</th><th>Unit</th><th>Specified interval</th><th>Flag</th></tr></thead><tbody><tr><td>${esc(r.analyte)}</td><td>${esc(r.value)}</td><td>${esc(r.unit)}</td><td>${r.lower ?? '-'} to ${r.upper ?? '-'}</td><td>${resultFlag(r)}</td></tr></tbody></table><p>${esc(r.notes)}</p><h2>Recorded review</h2><p>${esc(a.review.reviewer)} &middot; ${esc(a.review.at)}</p><p>${esc(a.review.comment)}</p><p class="muted">Reviewer names are locally entered acknowledgments. This installation does not authenticate reviewer identity or provide electronic signatures.</p><footer>Result revision: ${a.review.hash}<br>Laboratory revision: ${selected?.revision??current.lab.revision}</footer><p class="screen-only">Use your browser's Print command to print or save this sheet as PDF. This private sheet is excluded from website publication.</p></main></html>`;
  }
}
