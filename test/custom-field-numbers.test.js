import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validFields,fieldValueErrors} from '../src/web/custom-fields.js';
import {fieldNumberContext,setCustomFieldProperty} from '../src/web/custom-field-numbers.js';
import {exactRational} from '../src/web/measurement-model.js';
import {customFieldLabel} from '../src/web/custom-field-presentation.js';
import {templateFieldInput} from '../src/web/custom-field-input.js';
import {recordRevisionField} from '../src/web/record-revision-view.js';
import {sectionInput} from '../src/web/laboratory/section-editor.js';
import {templateFrom} from '../src/web/notebook-schema.js';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {Workspace} from '../src/storage.js';
import {RecordHistory} from '../src/record-history.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';

const numeric=(representation='decimal',radix=10)=>({version:1,representation,radix});
const field=(key='counter',context)=>({key,label:key,type:'number',unit:'ticks',required:true,choices:[],...(context?{numeric:context}:{})});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('number fields share exact measurement interpretation while preserving every legacy decimal spelling',()=>{
 const legacy=field();assert.ok(validFields([legacy]));
 for(const value of ['0','-0','-12.3400','9'.repeat(40)+'.'+'1'.repeat(18)])assert.deepEqual(fieldValueErrors([legacy],{counter:value}),[]);
 assert.deepEqual(fieldNumberContext(legacy),numeric());assert.equal(legacy.numeric,undefined);
 const cases=[['decimal',10,'-1.234e-70',-617n,5n*10n**72n],['integer',10,'9'.repeat(64),BigInt('9'.repeat(64)),1n],['radix',6,'155',71n,1n],['radix-fraction',6,'-15.30',-23n,2n],['radix',16,'+Ff',255n,1n],['rational',10,'-001/3',-1n,3n]];
 for(const [representation,radix,value,numerator,denominator] of cases){const f=field('counter',numeric(representation,radix));assert.ok(validFields([f]));assert.deepEqual(fieldValueErrors([f],{counter:value}),[]);assert.deepEqual(exactRational(value,representation,radix),{numerator,denominator});assert.equal(JSON.parse(JSON.stringify({f,value})).value,value);}
 for(const [representation,radix,value] of [['radix',6,'6'],['radix',6,'1.2'],['integer',10,'1e2'],['rational',10,'1/0'],['decimal',10,'1/3'],['radix-fraction',6,'1.6'],['decimal',10,123]])assert.deepEqual(fieldValueErrors([field('counter',numeric(representation,radix))],{counter:value}),['counter']);
 for(const context of [null,{},numeric('decimal',6),numeric('rational',6),numeric('radix',1),numeric('radix',37),numeric('unsupported'),{...numeric(),version:2},{...numeric(),extra:true}])assert.equal(validFields([{...field(),numeric:context}]),false);
 assert.equal(validFields([{...field('counter',numeric()),type:'text'}]),false);assert.equal(validFields([null]),false);
 assert.deepEqual(fieldValueErrors([field()],{}, {draft:true}),[]);assert.deepEqual(fieldValueErrors([field()],{}),['counter']);
});

test('schema controls pin interpretation, reject unrelated properties and escape contexts in all value inputs',()=>{
 const f={...field(),type:'text'},lab={sections:[{fields:[f]}]};
 const edit=(key,value)=>sectionInput({dataset:{labSection:'0',labField:'0',labFieldProp:key},value},lab);
 assert.equal(edit('type','number'),true);assert.deepEqual(f.numeric,numeric());edit('numericRepresentation','radix-fraction');edit('numericRadix','6');assert.deepEqual(f.numeric,numeric('radix-fraction',6));
 edit('numericRepresentation','rational');assert.deepEqual(f.numeric,numeric('rational'));edit('numericRepresentation','radix');edit('numericRadix','6');
 assert.equal(edit('__proto__',{}),false);assert.equal(edit('numericRepresentation','unsupported'),false);
 f.label='<img src=x>';assert.equal(customFieldLabel(f),'<img src=x> (ticks) · Base 6 integer');
 const html=templateFieldInput(f,'155',{esc});assert.ok(html.includes('type="text"'));assert.ok(html.includes('Base 6 integer'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('inputmode="decimal"'));
 const record={template:{label:'Acquisition',fields:[f],values:{counter:'155'}}};assert.ok(recordRevisionField('template',record,esc).includes('Base 6 integer'));
 setCustomFieldProperty(f,'type','text');assert.equal(Object.hasOwn(f,'numeric'),false);assert.ok(validFields([f]));
});

test('exact field contexts survive ordinary saves, template amendments, immutable history, public selection and encrypted recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-number-fields-')),book=sampleNotebook();
 const section={id:randomUUID(),profileId:null,key:'acquisition',label:'Acquisition',description:'Explicit representations',enabled:true,fields:[field('senary',numeric('radix-fraction',6)),field('fraction',numeric('rational')),field('large',numeric('integer'))]};
 book.notebooks[0].configuration={profiles:[],sections:[section]};const initial=book.entries.find(r=>r.notebookId===book.notebooks[0].id);initial.template={...templateFrom(section),values:{senary:'-15.30',fraction:'1/3',large:'9'.repeat(64)}};initial.share=true;book.projects.find(p=>p.id===book.notebooks[0].projectId).share=true;
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const records=new ResearchRecords(f.workspace,{}),history=new RecordHistory(f.workspace,{}),command={workspaceId:book.id,recordId:initial.id};
 const first=(await f.workspace.read()).book.entries.find(r=>r.id===initial.id),amended=structuredClone(first);amended.template.values.senary='+15.3';
 await records.save({workspaceId:book.id,changes:[{id:first.id,expectedRevision:recordRevision(first),record:amended}]});
 const saved=(await f.workspace.read()).book.entries.find(r=>r.id===initial.id);
 await f.workspace.update(value=>{value.notebooks[0].configuration.sections[0].fields[0].numeric.radix=8;return value;});
 const another=structuredClone(saved);another.template.values.senary='6';await assert.rejects(records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:another}]}),{code:'INVALID'});
 another.template.values.senary='5';another.template.fields[0].numeric.radix=8;await assert.rejects(records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:another}]}),{code:'INVALID'});
 const versions=await history.list(command);assert.equal(versions.versions.length,2);const original=versions.versions.find(v=>v.revision===recordRevision(first)),old=await history.read({...command,...original});assert.deepEqual(old.record.template,first.template);
 const reopened=(await new Workspace(f.workspace.root,f.vault).read()).book;assert.deepEqual(reopened.entries.find(r=>r.id===saved.id).template,saved.template);
 const projection=publicProjection(reopened),projected=projection.entries.find(r=>r.id===saved.id);assert.deepEqual(projected.sections.slice(0,3).map(s=>s.body),['+15.3','1/3','9'.repeat(64)]);assert.equal(projected.sections[0].title,'senary (ticks) · Base 6 fractional numeral');
 const publication=buildPublication(reopened);assert.ok([...publication.files.values()].some(bytes=>String(bytes).includes('Base 6 fractional numeral')&&String(bytes).includes('+15.3')));
 const backup=path.join(directory,'backup');await copyWorkspace(await copyPlan(f.workspace.root,backup),{vault:f.vault});const restored=new Workspace(backup,f.vault);assert.deepEqual((await restored.read()).book.entries.find(r=>r.id===saved.id).template,saved.template);assert.deepEqual((await new RecordHistory(restored,{}).read({...command,...original})).record.template,first.template);
});
