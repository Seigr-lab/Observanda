import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {importResearch} from '../src/migration/import-research.js';
import {mappedId,mergeImport,initialMapping,validateMapping} from '../src/migration/import-model.js';
import {researchAttributeChoices,importResearchPreview} from '../src/web/import-research-ui.js';
import {prepareImportedFigure} from '../src/migration/import-figure.js';
import {createFigure,validFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {createAnnotation} from '../src/web/figure-annotations.js';
import {createObservationAnnotation} from '../src/web/figure-observation-annotations.js';
import {portableResearch} from './fixtures/import-research.js';
import {event} from './fixtures/attempts.js';
import {validAttempt,appendOnlyAttempt} from '../src/web/attempt-model.js';

function fixture(){
 const id=randomUUID(),record={id,relations:[{id:mappedId(id,'link',0),role:'uses-method',label:'Retained method',target:{kind:'record',workspaceId:randomUUID(),id:randomUUID(),revision:'a'.repeat(64)}}],figures:[{id:randomUUID(),panels:[{figure:{id:randomUUID()}}]}]};
 return {record,source:portableResearch()};
}
const convert=(source,record)=>importResearch(JSON.stringify({facts:source}),{path:'/facts'},record);

test('declared record facts preserve exact text, method revisions and criterion identity',async()=>{
 const {source,record}=fixture(),p=source.attempt.preparations[0];
 source.results.statements.push({...source.results.statements[0],id:'panel-result',kind:'figure',figureId:{figure:0,panel:0}});
 const mapped=await convert(source,record);
 assert.ok(validAttempt(mapped.attempt));assert.equal(mapped.attempt.preparations[0].id,mappedId(record.id,'research-fact',p.id));
 assert.deepEqual(mapped.attempt.preparations[0].protocols[0],{...record.relations[0].target,label:'Retained method'});
 assert.equal(mapped.attempt.preparations[0].conditions[0].value,'105 (base 6)');
 assert.equal(mapped.template.values.counter,'900719925474099312345');assert.equal(mapped.status,'completed');assert.equal(mapped.outcome,source.outcome);
 assert.equal(mapped.attempt.assessments[0].criterionId,mapped.attempt.preparations[0].criteria[0].id);
 assert.equal(mapped.results.statements[1].figureId,record.figures[0].panels[0].figure.id);assert.equal(mapped.results.statements[0].limitations,source.results.statements[0].limitations);
 assert.equal(await importResearch(null,null,record),record);assert.equal(source.attempt.preparations[0].id,p.id);
 assert.deepEqual(researchAttributeChoices(JSON.stringify({'with/slash~':{facts:source},noise:4})),['/with~1slash~0/facts']);
});

test('invalid declarations, guessed methods and lossy numeric values are rejected before import',async()=>{
 for(const mutate of [
  f=>{f.source.extra=true;},f=>{f.source.attempt.preparations[0].protocols=[{link:1}];},
  f=>{f.record.relations[0].role='';},f=>{delete f.record.relations[0].target.revision;},
  f=>{f.source.attempt.events[0].preparationId='missing';},f=>{f.source.attempt.events.push(f.source.attempt.events[0]);},
  f=>{f.source.template.values.counter=9007199254740992;},f=>{f.source.template.values.counter=0.125;},
  f=>{f.source.results.statements[0].limitations='';},f=>{f.source.results.statements[0].kind='figure';f.source.results.statements[0].figureId={figure:9};}
 ]){const f=fixture();mutate(f);await assert.rejects(convert(f.source,f.record),{code:'IMPORT_RESEARCH'});}
 const f=fixture();await assert.rejects(importResearch(JSON.stringify(f.source).replace('900719925474099312345','PRECISION').replace('"PRECISION"','1.0000000000000000001'),{path:''},f.record),{code:'IMPORT_RESEARCH'});
 const aborted=new AbortController();aborted.abort();await assert.rejects(importResearch(JSON.stringify(f.source),{path:''},f.record,{signal:aborted.signal}),{name:'AbortError'});
 const object={title:'Mapped',disposition:'map',mapping:{kind:'run'},files:[{selector:{kind:'whole'}}],dates:[],links:[]},mapping=initialMapping(object,randomUUID());
 for(const research of [{path:'bad'},{path:'/bad~2'},[],{path:'',unexpected:true}])assert.throws(()=>validateMapping({...mapping,research},object),{code:'IMPORT_RESEARCH'});
 const {research,metadataMode,...legacy}=mapping;assert.doesNotThrow(()=>validateMapping(legacy,object));
});

test('source corrections and concurrent local events append without rewriting earlier facts',async()=>{
 const f=fixture(),base=await convert(f.source,f.record),local=structuredClone(base);local.attempt.events.push(event(local.attempt.preparations[0],{label:'Local follow-up'}));
 const correction={...f.source.attempt.assessments[0],id:'correction',supersedes:f.source.attempt.assessments[0].id,observed:'Corrected denominator',reason:'Count reconciled against the capture'};
 f.source.attempt.assessments.push(correction);const incoming=await convert(f.source,f.record),merged=mergeImport(base,local,incoming);
 assert.deepEqual(merged.conflicts,[]);assert.ok(appendOnlyAttempt(local.attempt,merged.record.attempt));
 assert.equal(merged.record.attempt.events.at(-1).label,'Local follow-up');assert.equal(merged.record.attempt.assessments.at(-1).observed,'Corrected denominator');
 const rewritten=structuredClone(incoming);rewritten.attempt.assessments[0].observed='Silent replacement';
 for(const resolution of ['merge','source','local']){const failed=mergeImport(base,local,rewritten,resolution);assert.ok(failed.conflicts.includes('attempt'));assert.deepEqual(failed.record.attempt,local.attempt);}
 const omitted=structuredClone(incoming);delete omitted.attempt;assert.deepEqual(mergeImport(base,local,omitted,'source').record.attempt,local.attempt);
});

test('status-only declarations remain visible in the proposed facts preview',()=>{
 assert.match(importResearchPreview({status:'completed'},value=>String(value)),/Completed/);
 assert.equal(importResearchPreview(null,String),'');
});

test('imported compound figures retain panel data and annotations with stable identities belonging to each record',async()=>{
 const plot=createFigure();plot.series[0].points=[{x:1,y:2,error:null}];plot.annotations=[{...createAnnotation('interval'),start:0,end:2,label:'Acquisition window'},{...createObservationAnnotation('callout',plot),label:'First observation'}];
 const source=createComposition([plot,plot]),body=JSON.stringify(source),file={selector:{kind:'whole'}},record=randomUUID();
 const prepare=id=>prepareImportedFigure({size:Buffer.byteLength(body),read:()=>[Buffer.from(body)]},file,id),first=await prepare(record),repeat=await prepare(record),other=await prepare(randomUUID());
 assert.ok(validFigure(first.figures[0]));assert.deepEqual(first.figures,repeat.figures);assert.equal(first.body,body);
 const ids=figure=>[figure.id,...figure.panels.flatMap(p=>[p.id,p.figure.id,...p.figure.series.map(s=>s.id),...p.figure.annotations.map(a=>a.id)])];
 assert.equal(new Set([...ids(source),...ids(first.figures[0]),...ids(other.figures[0])]).size,ids(source).length*3);
 assert.deepEqual(first.figures[0].panels.map(p=>p.figure.series[0].points),source.panels.map(p=>p.figure.series[0].points));
 assert.equal(first.figures[0].panels[0].figure.annotations[0].label,'Acquisition window');
 for(const panel of first.figures[0].panels)assert.equal(panel.figure.annotations[1].seriesId,panel.figure.series[0].id);
 const single=await prepareImportedFigure({size:Buffer.byteLength(JSON.stringify(plot)),read:()=>[Buffer.from(JSON.stringify(plot))]},file,record);
 assert.equal(single.figures[0].id,mappedId(record,'figure'));assert.equal(single.figures[0].series[0].id,mappedId(record,'figure-series',0));assert.ok(validFigure(single.figures[0]));
});
