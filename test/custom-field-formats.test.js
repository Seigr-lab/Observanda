import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validFields,fieldValueErrors} from '../src/web/custom-fields.js';
import {setCustomFieldProperty} from '../src/web/custom-field-numbers.js';
import {TEXT_FIELD_FORMATS,textFieldValueValid} from '../src/web/custom-field-formats.js';
import {customFieldLabel,customFieldText} from '../src/web/custom-field-presentation.js';
import {templateFieldInput} from '../src/web/custom-field-input.js';
import {fieldTextFormatControls} from '../src/web/custom-field-format-controls.js';
import {sectionInput} from '../src/web/laboratory/section-editor.js';
import {validConfigurationField} from '../src/web/configuration-model.js';
import {templateFrom} from '../src/web/notebook-schema.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {Workspace} from '../src/storage.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(key,format)=>({key,label:key,type:'text',unit:'',required:false,choices:[],...(format?{format}:{})});
const sha256='9F86D081884C7D659A2FEAA0C55AD015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const sha512='ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff';

test('exact text formats validate identifiers, addresses and digests without rewriting them',()=>{
 for(const format of TEXT_FIELD_FORMATS)assert.ok(validFields([field('value',format)]),format);
 for(const invalid of [{...field('value'),format:'sha-999'},{...field('value'),format:''},{...field('value','sha-256'),type:'number',numeric:{version:1,representation:'decimal',radix:10}},{...field('value','sha-256'),type:'select',choices:['a']}])assert.equal(validFields([invalid]),false);
 const fields=[field('image','sha-256'),field('archive','sha-512'),field('serial','identifier'),field('origin','uri'),field('notes')];
 const values={image:sha256,archive:sha512,serial:'SN-0042/rev B',origin:'https://example.org/repository.git',notes:'  free text keeps its spaces  '};
 assert.deepEqual(fieldValueErrors(fields,values),[]);assert.deepEqual(values.image,sha256,'mixed case is kept as entered');
 assert.deepEqual(fieldValueErrors(fields,{image:sha256.slice(1)}),['image']);
 assert.deepEqual(fieldValueErrors(fields,{image:sha256+' '}),['image']);
 assert.deepEqual(fieldValueErrors(fields,{archive:sha256}),['archive']);
 assert.deepEqual(fieldValueErrors(fields,{serial:' SN-0042'}),['serial']);
 assert.deepEqual(fieldValueErrors(fields,{serial:'SN\n0042'}),['serial']);
 assert.deepEqual(fieldValueErrors(fields,{origin:'repository.git'}),['origin']);
 assert.deepEqual(fieldValueErrors(fields,{origin:'https://example.org/a b'}),['origin']);
 assert.ok(textFieldValueValid('md5','d41d8cd98f00b204e9800998ecf8427e'));assert.ok(textFieldValueValid('sha-1','da39a3ee5e6b4b0d3255bfef95601890afd80709'));
 assert.equal(textFieldValueValid('sha-256','g'.repeat(64)),false);
});

test('schema controls set and clear a text format, and the value input stays one verbatim line',()=>{
 const f=field('image'),lab={sections:[{fields:[f]}]};
 const edit=(key,value)=>sectionInput({dataset:{labSection:'0',labField:'0',labFieldProp:key},value},lab);
 assert.equal(edit('format','sha-256'),true);assert.equal(f.format,'sha-256');assert.ok(validConfigurationField({key:f.key,label:f.label,type:f.type,unit:f.unit,required:f.required,format:f.format}));
 assert.equal(edit('format','unsupported'),false);assert.equal(f.format,'sha-256');
 assert.equal(customFieldLabel(f),'image · '+customFieldText('formats.sha-256'));
 const html=templateFieldInput(f,sha256,{esc});
 assert.ok(html.startsWith('<input'));assert.ok(html.includes('value="'+sha256+'"'));assert.ok(html.includes('spellcheck="false"'));assert.ok(html.includes('maxlength="64"'));
 const option=(value,label,current)=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+label+'</option>';
 assert.ok(fieldTextFormatControls(f,{field:(label,control)=>control,option},key=>'data-prop="'+key+'"').includes('value="sha-256" selected'));
 assert.equal(fieldTextFormatControls({...f,type:'number'},{field:(l,c)=>c,option},()=>''),'');
 assert.equal(edit('format',''),true);assert.equal(Object.hasOwn(f,'format'),false);
 edit('format','identifier');setCustomFieldProperty(f,'type','number');assert.equal(Object.hasOwn(f,'format'),false);assert.ok(validFields([f]));
 assert.equal(setCustomFieldProperty(f,'format','identifier'),false,'only text fields carry a format');
});

test('formats survive configuration drafts, saved books, record saves and reopening',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-field-formats-')),book=upgradeNotebook(sampleNotebook()),sectionId=randomUUID();
 const section={id:sectionId,profileId:null,key:'release',label:'Release',description:'',enabled:true,fields:[field('image','sha-256'),field('tag','identifier')]};
 const notebook=book.notebooks[0];notebook.configuration={profiles:[],sections:[section]};
 const record=book.entries.find(r=>r.notebookId===notebook.id);record.template={...templateFrom(section),values:{image:sha256,tag:'v1.0.0-rc.1+build.7'}};
 const fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;
 t.after(async()=>{await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const commands=new ConfigurationCommands(workspace),owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 const opened=await commands.open(owner),base={...owner,configurationPin:opened.configurationPin};
 const first=await commands.change({...base,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[
  {type:'append',collection:'fields',sectionId,value:{key:'archive',label:'Archive',type:'text',unit:'',required:false,choices:[],format:'sha-512'}},
  {type:'replace',collection:'fields',sectionId,key:'tag',value:{type:'number',numeric:{version:1,representation:'integer',radix:10}},remove:['format']}
 ]});
 const draft={...base,draftId:first.draft.id,draftRevision:first.draft.revision};
 const fields=await commands.window({...draft,collection:'fields',sectionId,offset:0,limit:10});
 assert.deepEqual(fields.rows.map(row=>[row.key,row.value.type,row.value.format??null]),[['image','text','sha-256'],['tag','number',null],['archive','text','sha-512']]);
 await assert.rejects(commands.change({...base,draftId:first.draft.id,expectedRevision:first.draft.revision,commandId:randomUUID(),operations:[{type:'replace',collection:'fields',sectionId,key:'image',value:{format:'sha-999'}}]}),{code:'INVALID'});
 await assert.rejects(commands.change({...base,draftId:first.draft.id,expectedRevision:first.draft.revision,commandId:randomUUID(),operations:[{type:'replace',collection:'fields',sectionId,key:'image',value:{label:'Image'},remove:['label']}]}),{code:'INVALID'});
 const records=new ResearchRecords(workspace,{get:async()=>{throw Error('Unexpected media');}});
 const saved=(await workspace.read()).book.entries.find(r=>r.id===record.id);assert.deepEqual(saved.template.values,{image:sha256,tag:'v1.0.0-rc.1+build.7'});
 const wrong=structuredClone(saved);wrong.template.values.image=sha256.toLowerCase()+'0';
 await assert.rejects(records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:wrong}]}),{code:'INVALID'});
 const right=structuredClone(saved);right.template.values.image=sha256.toLowerCase();
 await records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:right}]});
 const reopened=(await new Workspace(workspace.root,fixture.vault).read()).book.entries.find(r=>r.id===record.id);
 assert.equal(reopened.template.values.image,sha256.toLowerCase());assert.equal(reopened.template.fields[0].format,'sha-256');
});
