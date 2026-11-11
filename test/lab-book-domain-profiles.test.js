import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {laboratoryProfiles,profileById,enableProfile} from '../src/web/laboratory/catalog.js';
import {laboratoryModules} from '../src/web/laboratory/modules.js';
import {validConfiguration,templateFrom,validTemplate} from '../src/web/notebook-schema.js';
import {fieldValueErrors} from '../src/web/custom-fields.js';
import {activityContext,activitySubjects} from '../src/web/record-activity.js';

const digest=length=>'0123456789abcdef'.repeat(8).slice(0,length);
// One plausible value for every field, exact formats included.
function sample(field){
 if(field.type==='select')return field.choices[0];
 if(field.type==='number')return '42';
 if(field.type==='date')return '2026-11-11';
 return {'sha-256':digest(64),'sha-512':digest(128),identifier:'ID-0001/rev.A',uri:'https://example.org/item'}[field.format]??'Recorded text';
}
// A lab book of one profile, with one record of every section linked to a subject record.
function book(id){
 const configuration={profiles:[],sections:[]};enableProfile(configuration,id,true);assert.ok(validConfiguration(configuration),id);
 const notebook={id:randomUUID(),projectId:null,title:'Book',configuration},entries=configuration.sections.map(section=>{
  const template=templateFrom(section);template.values=Object.fromEntries(section.fields.map(f=>[f.key,sample(f)]));
  assert.ok(validTemplate(template),id+' '+section.key);assert.deepEqual(fieldValueErrors(section.fields,template.values),[]);
  return {id:randomUUID(),notebookId:notebook.id,title:section.label,template,relations:[]};
 });
 return {book:{notebooks:[notebook],entries},configuration};
}

test('every profile copies into a valid lab book whose records accept a value in every field',()=>{
 for(const profile of laboratoryProfiles)book(profile.id);
 assert.deepEqual(laboratoryModules.map(m=>m.labBookType.id).sort(),laboratoryProfiles.map(p=>p.id).sort());
});

function tracks(id,{subjects,primary,events,formats}){
 const profile=profileById(id);assert.ok(profile,id);
 assert.deepEqual(profile.tracking.subjects,subjects);assert.equal(profile.tracking.primary,primary);assert.deepEqual(profile.tracking.events,events);
 const {book:value,configuration}=book(id);
 for(const record of value.entries){
  const section=configuration.sections.find(s=>s.id===record.template.id),context=activityContext(value,record);
  assert.equal(context.subject,subjects.includes(section.key),section.key);assert.equal(context.event,events.includes(section.key),section.key);
 }
 const keyOf=record=>configuration.sections.find(s=>s.id===record.template.id).key,first=value.entries[0];
 assert.deepEqual(activitySubjects(value,first).map(keyOf).sort(),subjects.filter(key=>key!==keyOf(first)).sort());
 for(const [path,format] of Object.entries(formats)){const [section,field]=path.split('/');assert.equal(profile.sections.find(s=>s.key===section).fields.find(f=>f.key===field).format,format,path);}
 return profile;
}

test('software development tracks repositories, builds, images and releases with exact identifiers and digests',()=>{
 tracks('software-development',{subjects:['repository','build','image','release'],primary:'change',events:['change','build','image','test-run','release','deployment','incident','decision'],
  formats:{'repository/url':'uri','change/base-commit':'identifier','build/sha256':'sha-256','build/sha512':'sha-512','image/sha256':'sha-256','image/sha512':'sha-512','release/version':'identifier','release/tag':'identifier','release/sha512':'sha-512','deployment/observed-sha256':'sha-256'}});
 const {book:value}=book('software-development'),build=value.entries.find(r=>r.template.label==='Build');
 assert.deepEqual(fieldValueErrors(build.template.fields,{...build.template.values,sha256:digest(63)}),['Artefact SHA-256']);
});

test('music tracks works, sessions, takes and release editions following the shared music model',()=>{
 tracks('music',{subjects:['work','session','take','release'],primary:'session',events:['session','take','derivative','listening','performance','credits','release','reflection'],
  formats:{'work/iswc':'identifier','take/file':'identifier','take/sha256':'sha-256','derivative/sha256':'sha-256','credits/isrc':'identifier','release/barcode':'identifier','release/master-sha256':'sha-256'}});
 const work=profileById('music').sections.find(s=>s.key==='work');
 assert.deepEqual(work.fields.find(f=>f.key==='state').choices,['Idea','Work in progress','Session captured','Source retained','Edition selected']);
 assert.deepEqual(profileById('music').sections.find(s=>s.key==='take').fields.find(f=>f.key==='status').choices,['Kept','Alternate','Abandoned','Failed'],'failed and abandoned takes remain evidence');
});

test('historical research tracks sources, people, places and events and keeps stated text apart from readings',()=>{
 const profile=tracks('historical-research',{subjects:['source','person','place','event'],primary:'examination',events:['visit','examination','analysis','correspondence'],
  formats:{'source/reference':'identifier','source/identifier':'uri','source/copy-sha256':'sha-256','person/authority':'uri','place/gazetteer':'uri','visit/requests':'identifier','correspondence/reference':'identifier'}});
 for(const key of ['source','event']){const fields=profile.sections.find(s=>s.key===key).fields;assert.equal(fields.find(f=>f.key==='date-stated').type,'text');assert.deepEqual(fields.find(f=>f.key==='certainty').choices,['Exact','Approximate','Inferred','Unknown']);}
});
