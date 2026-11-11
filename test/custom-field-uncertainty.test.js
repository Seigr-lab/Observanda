import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validFields,fieldValueErrors} from '../src/web/custom-fields.js';
import {setCustomFieldProperty} from '../src/web/custom-field-numbers.js';
import {fieldUncertaintyParts} from '../src/web/custom-field-uncertainty.js';
import {customFieldLabel,customFieldText} from '../src/web/custom-field-presentation.js';
import {templateFieldInput} from '../src/web/custom-field-input.js';
import {fieldNumberControls} from '../src/web/custom-field-number-controls.js';
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
const field=(key,uncertainty,numeric)=>({key,label:key,type:'number',unit:'mV',required:false,choices:[],...(numeric?{numeric}:{}),...(uncertainty?{uncertainty}:{})});

test('number fields read stated uncertainties exactly and keep the spelling with its significant digits',()=>{
 const fields=[field('absolute','absolute'),field('relative','relative'),field('interval','interval'),field('plain')];
 assert.ok(validFields(fields));
 const values={absolute:'12.30 ± 0.05',relative:'-12.300 +/- 0.40 %',interval:'[12.25, 12.350]',plain:'12.30'};
 assert.deepEqual(fieldValueErrors(fields,values),[]);assert.equal(values.absolute,'12.30 ± 0.05');
 assert.deepEqual(fieldValueErrors(fields,{absolute:'12.30',relative:'12.3',interval:'12.3'}),[],'an undeclared uncertainty stays valid');
 for(const [key,value] of [['absolute','12.30 ± -0.05'],['absolute','12.30 ± 0.4 %'],['absolute','12.30 ±'],['relative','12.30 ± 0.4'],['interval','[12.35, 12.25]'],['interval','[a, 1]'],['plain','12.30 ± 0.05']])
  assert.deepEqual(fieldValueErrors(fields,{[key]:value}),[key],key+' '+value);
 assert.deepEqual(fieldUncertaintyParts('interval','[1.0; 2.00]'),{lower:'1.0',upper:'2.00'});
 const senary=field('senary','absolute',{version:1,representation:'radix-fraction',radix:6});assert.deepEqual(fieldValueErrors([senary],{senary:'15.3 ± 0.1'}),[]);assert.deepEqual(fieldValueErrors([senary],{senary:'15.3 ± 0.6'}),['senary']);
 for(const invalid of [{...field('x'),uncertainty:'standard'},{...field('x'),type:'text',uncertainty:'absolute'}])assert.equal(validFields([invalid]),false);
});

test('schema controls set and clear the uncertainty, and the input shows its written form',()=>{
 const f=field('reading'),lab={sections:[{fields:[f]}]};
 const edit=(key,value)=>sectionInput({dataset:{labSection:'0',labField:'0',labFieldProp:key},value},lab);
 assert.equal(edit('uncertainty','absolute'),true);assert.equal(f.uncertainty,'absolute');assert.equal(edit('uncertainty','standard'),false);
 assert.ok(validConfigurationField({key:f.key,label:f.label,type:f.type,unit:f.unit,required:false,uncertainty:'absolute'}));
 assert.equal(customFieldLabel(f),'reading (mV) · '+customFieldText('uncertainties.absolute'));
 const html=templateFieldInput(f,'1.0 ± 0.1',{esc});assert.ok(html.includes('placeholder="'+esc(customFieldText('uncertaintyExamples.absolute'))+'"'));assert.ok(html.includes('value="1.0 ± 0.1"'));
 const option=(value,label,current)=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+label+'</option>';
 assert.ok(fieldNumberControls(f,{field:(l,c)=>c,option,esc},key=>'data-prop="'+key+'"').includes('value="absolute" selected'));
 assert.equal(edit('uncertainty',''),true);assert.equal(Object.hasOwn(f,'uncertainty'),false);
 edit('uncertainty','interval');setCustomFieldProperty(f,'type','text');assert.equal(Object.hasOwn(f,'uncertainty'),false);assert.ok(validFields([f]));
});

test('uncertainty declarations survive configuration drafts, record saves and reopening',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-field-uncertainty-')),book=upgradeNotebook(sampleNotebook()),sectionId=randomUUID();
 const section={id:sectionId,profileId:null,key:'reading',label:'Reading',description:'',enabled:true,fields:[field('voltage','absolute')]};
 const notebook=book.notebooks[0];notebook.configuration={profiles:[],sections:[section]};
 const record=book.entries.find(r=>r.notebookId===notebook.id);record.template={...templateFrom(section),values:{voltage:'3.300 ± 0.005'}};
 const fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;
 t.after(async()=>{await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const commands=new ConfigurationCommands(workspace),owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 const opened=await commands.open(owner),base={...owner,configurationPin:opened.configurationPin};
 const changed=await commands.change({...base,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[
  {type:'append',collection:'fields',sectionId,value:{key:'ratio',label:'Ratio',type:'number',unit:'',required:false,choices:[],uncertainty:'relative'}},
  {type:'replace',collection:'fields',sectionId,key:'voltage',value:{type:'text'},remove:['numeric','uncertainty']}
 ]});
 const fields=await commands.window({...base,draftId:changed.draft.id,draftRevision:changed.draft.revision,collection:'fields',sectionId,offset:0,limit:10});
 assert.deepEqual(fields.rows.map(row=>[row.key,row.value.type,row.value.uncertainty??null]),[['voltage','text',null],['ratio','number','relative']]);
 const records=new ResearchRecords(workspace,{get:async()=>{throw Error('Unexpected media');}});
 const saved=(await workspace.read()).book.entries.find(r=>r.id===record.id);assert.equal(saved.template.values.voltage,'3.300 ± 0.005');
 const wrong=structuredClone(saved);wrong.template.values.voltage='3.300 ± 0.5 %';
 await assert.rejects(records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:wrong}]}),{code:'INVALID'});
 const right=structuredClone(saved);right.template.values.voltage='3.3000 ± 0.0050';
 await records.save({workspaceId:book.id,changes:[{id:saved.id,expectedRevision:recordRevision(saved),record:right}]});
 const reopened=(await new Workspace(workspace.root,fixture.vault).read()).book.entries.find(r=>r.id===record.id);
 assert.equal(reopened.template.values.voltage,'3.3000 ± 0.0050');assert.equal(reopened.template.fields[0].uncertainty,'absolute');
});
