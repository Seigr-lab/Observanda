import {sampleAnalysisDomain,sampleAnalysisTransaction} from './sample-analysis-storage.js';
import { Workspace, digest, serialize } from './storage.js';
import { AppError } from './errors.js';
import { escapeHTML } from './publication.js';
import { assertPublicFields } from './privacy.js';
import {observeRunQuality} from './sample-run-quality.js';
import {runQualitySection} from './sample-run-quality-report.js';
import {SampleAnalysisCatalogue} from './sample-analysis-catalogue.js';

export {resultFlag} from './sample-analysis-model.js';
import {resultFlag} from './sample-analysis-model.js';
import {displaySampleScalar} from './web/sample-result-format.js';
import {verifySampleResultSources} from './sample-result-sources.js';
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const fail=()=>{throw new AppError('LAB_INVALID');};
const recordRevisions=lab=>Object.fromEntries([...lab.samples,...lab.analyses].map(record=>[record.id,digest(serialize(record))]));

export class Laboratory {
  constructor(root, vault = null) { this.workspace = root instanceof Workspace?root:new Workspace(root,vault); }
  // Samples and analyses live in the owner's samples domain.
  async catalogue(operation,options={}){
    return sampleAnalysisTransaction(this.workspace,await sampleAnalysisDomain(this.workspace),operation,options);
  }
  async read({revisions=true}={}) {
    return this.catalogue(async store=>{
      const owner=new SampleAnalysisCatalogue(store),source=await owner.source(),lab=await owner.assemble(source);
      return {lab,etag:source.etag,recordRevisions:revisions?recordRevisions(lab):{}};
    });
  }
  async change(command,{compact=false,commandId=null,signal,check}={}) {
    if(commandId!==null&&!id(commandId))fail();
    const verifyResult = result => verifySampleResultSources(this.workspace,result,{signal});
    const domain=await sampleAnalysisDomain(this.workspace);
    const hasRunInputs=command.action==='create-analysis'&&Object.hasOwn(command.analysis??{},'runInputs');
    return sampleAnalysisTransaction(this.workspace,domain,async(store,inventory)=>{
      const fingerprint=digest(serialize(command)),receipt=commandId?await store.object('laboratory-command/'+commandId):null,owner=new SampleAnalysisCatalogue(store),source=await owner.source();
      let result;
      if(receipt){if(receipt.fingerprint!==fingerprint)throw new AppError('LAB_STALE');result=receipt.result;}
      else{
        result=await owner.change(source,commandId&&['create-sample','create-analysis'].includes(command.action)?{...command,etag:source.etag}:command,{verifyResult,observeRun:(inputs,now)=>observeRunQuality(inventory,domain,inputs,now)});
        if(commandId)await store.putObject('laboratory-command/'+commandId,{fingerprint,result});
      }
      if(compact)return result;
      const current=await owner.source(),lab=await owner.assemble(current);return {lab,etag:current.etag,recordRevisions:recordRevisions(lab),selectedId:result.selectedId};
    },{write:true,inventory:hasRunInputs,signal,check});
  }
  async snapshot(expectedEtag=null,{retained=true}={}) {
    return this.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store),source=await owner.source(expectedEtag,{retained});return {lab:await owner.assemble(source),etag:source.etag};});
  }
  async report(id, expectedEtag, blockedValues = [], {retained=false,language='en'}={}) {
    const selected=await this.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store),source=await owner.source(expectedEtag,{retained});return {analysis:(await owner.selected(source,'analysis',id)).record,revision:source.head.revision};});
    const a = selected.analysis;
    if (!a || !['approved', 'archived'].includes(a.status)) throw new AppError('LAB_TRANSITION');
    assertPublicFields([{ field: 'result sheet', value: JSON.stringify(a) }], blockedValues);
    const esc = escapeHTML, s = a.review.sample, r = a.result, runQuality = await runQualitySection(a.runQuality, {language, esc});
    const reading = value => esc(displaySampleScalar(value, (key, {value: spelling, base}) =>
      ({shownBase: `${spelling} (base ${base})`, shownApproximate: `${spelling} (approximate)`,
        shownHistorical: `${spelling} (historical approximation; original notation unavailable)`})[key]));
    const roles = {reading:'Result source',method:'Method record',calibration:'Calibration',evidence:'Supporting evidence'};
    const references = Object.entries(r.provenance??{}).map(([role,{ref,cell}]) =>
      `<dt>${roles[role]}</dt><dd>${esc(ref.kind)} <code>${esc(ref.id)}</code> &middot; workspace <code>${esc(ref.workspaceId)}</code> &middot; revision <code>${esc(ref.revision)}</code>${cell ? ` &middot; page ${cell.page+1}, row ${cell.row+1}, column ${cell.column+1}` : ''}</dd>`).join('');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Result sheet ${esc(a.code)}</title><link rel="stylesheet" href="/report.css"><main><p>Observanda / Laboratory results</p><h1>Result sheet</h1><p>Analysis <strong>${esc(a.code)}</strong> &middot; ${esc(a.status)}</p><dl><dt>Sample</dt><dd>${esc(s.code)}</dd><dt>Material</dt><dd>${esc(s.material)}</dd><dt>Source reference</dt><dd>${esc(s.source || 'Not specified')}</dd><dt>Collected / received</dt><dd>${s.collectedOn} / ${s.receivedOn}</dd><dt>Method and version</dt><dd>${esc(r.method)}</dd>${references}</dl><table><thead><tr><th>Analyte</th><th>Result</th><th>Unit</th><th>Specified interval</th><th>Flag</th></tr></thead><tbody><tr><td>${esc(r.analyte)}</td><td>${reading(r.value)}</td><td>${esc(r.unit)}</td><td>${reading(r.lower)} to ${reading(r.upper)}</td><td>${resultFlag(r)}</td></tr></tbody></table><p>${esc(r.notes)}</p>${runQuality}<h2>Recorded review</h2><p>${esc(a.review.reviewer)} &middot; ${esc(a.review.at)}</p><p>${esc(a.review.comment)}</p><p class="muted">Reviewer names are locally entered acknowledgments. This installation does not authenticate reviewer identity or provide electronic signatures.</p><footer>Result revision: ${a.review.hash}<br>Laboratory revision: ${selected.revision}</footer><p class="screen-only">Use your browser's Print command to print or save this sheet as PDF. This private sheet is excluded from website publication.</p></main></html>`;
  }
}
