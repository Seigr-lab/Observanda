import {test} from 'node:test';
import assert from 'node:assert/strict';
import {laboratoryProfiles,enableProfile,profileUpgrade,upgradeProfile} from '../src/web/laboratory/catalog.js';
import {profileUpgradeItems} from '../src/web/laboratory/profile-text.js';
import {validConfiguration} from '../src/web/notebook-schema.js';

// A later version of an existing profile: one new section, one new field and one new choice.
function nextVersion(){
 const current=laboratoryProfiles.find(p=>p.id==='beekeeping'),next=structuredClone(current);next.version=current.version+1;
 next.introduced.sections.harvest=next.version;
 next.introduced.fields['inspection/next-visit']=next.version;
 next.introduced.choices['colony/origin/Unknown']=next.version;
 return {current,next};
}

test('shipped profiles describe every item with the version that introduced it',()=>{
 for(const profile of laboratoryProfiles){
  for(const s of profile.sections){
   assert.ok(profile.introduced.sections[s.key]<=profile.version,profile.id+' '+s.key);
   for(const f of s.fields){assert.ok(profile.introduced.fields[s.key+'/'+f.key]<=profile.version);for(const c of f.choices)assert.ok(profile.introduced.choices[s.key+'/'+f.key+'/'+c]<=profile.version);}
  }
  const plan=profileUpgrade(profile,profile.version);assert.deepEqual([plan.sections,plan.fields,plan.choices],[[],[],[]]);
 }
});

test('an upgrade adds only newer items and keeps author edits, removals and order',()=>{
 const {next}=nextVersion(),lab={profiles:[],sections:[]};
 enableProfile(lab,'beekeeping',true);
 // What the current version would have copied: without the items version 2 introduced.
 lab.sections=lab.sections.filter(s=>s.key!=='harvest');
 const inspection=lab.sections.find(s=>s.key==='inspection'),colony=lab.sections.find(s=>s.key==='colony'),origin=colony.fields.find(f=>f.key==='origin');
 inspection.fields=inspection.fields.filter(f=>f.key!=='next-visit');origin.choices=origin.choices.filter(c=>c!=='Unknown');
 // Author edits after adopting version 1.
 inspection.label='Visit';inspection.fields=inspection.fields.filter(f=>f.key!=='weather');origin.choices=origin.choices.filter(c=>c!=='Package');
 const monitoring=lab.sections.find(s=>s.key==='monitoring');monitoring.enabled=false;lab.sections.reverse();
 const order=lab.sections.map(s=>s.id),before=structuredClone(lab);
 const {current}=nextVersion(),plan=profileUpgrade(next,current.version);
 assert.deepEqual(plan.sections.map(s=>s.key),['harvest']);assert.deepEqual(plan.fields.map(f=>f.section+'/'+f.field.key),['inspection/next-visit']);assert.deepEqual(plan.choices,[{section:'colony',field:'origin',choice:'Unknown'}]);
 assert.equal(profileUpgradeItems(plan).length,3);
 assert.equal(upgradeProfile(lab,'beekeeping',next),true);
 assert.ok(validConfiguration(lab));assert.equal(lab.profiles[0].version,next.version);
 assert.deepEqual(lab.sections.slice(0,order.length).map(s=>s.id),order,'existing order is kept and new sections are appended');
 assert.equal(lab.sections.at(-1).key,'harvest');
 assert.equal(inspection.label,'Visit');assert.ok(!inspection.fields.some(f=>f.key==='weather'),'removed fields stay removed');
 assert.equal(inspection.fields.at(-1).key,'next-visit');assert.ok(!origin.choices.includes('Package'));assert.equal(origin.choices.at(-1),'Unknown');
 assert.equal(monitoring.enabled,false);
 const after=structuredClone(lab);assert.equal(upgradeProfile(lab,'beekeeping',next),false);assert.deepEqual(lab,after);
 assert.notDeepEqual(before,after);
});

test('a book without the profile, or already current, is never changed',()=>{
 const {next}=nextVersion(),empty={profiles:[],sections:[]};
 assert.equal(upgradeProfile(empty,'beekeeping',next),false);assert.deepEqual(empty,{profiles:[],sections:[]});
 const current={profiles:[],sections:[]};enableProfile(current,'beekeeping',true);const copy=structuredClone(current);
 assert.equal(upgradeProfile(current,'beekeeping'),false);assert.deepEqual(current,copy);
});

test('a physical prototyping book from version 1 adopts version 2 without touching its records',async()=>{
 const {templateFrom,validTemplate}=await import('../src/web/notebook-schema.js');
 const profile=laboratoryProfiles.find(p=>p.id==='physical-prototyping'),lab={profiles:[],sections:[]};
 enableProfile(lab,profile.id,true);lab.profiles[0].version=1;
 lab.sections=lab.sections.filter(s=>profile.introduced.sections[s.key]===1);
 for(const s of lab.sections)s.fields=s.fields.filter(f=>profile.introduced.fields[s.key+'/'+f.key]===1);
 const bringUp=lab.sections.find(s=>s.key==='bring-up');bringUp.label='Power-on test';
 const record=templateFrom(bringUp);record.values={field1:'Board 3'};const before=structuredClone(record);
 assert.ok(upgradeProfile(lab,profile.id));assert.ok(validConfiguration(lab));
 assert.deepEqual(lab.sections.map(s=>s.key),['design','assembly','bring-up','rework','findings','device','unit','firmware']);
 assert.equal(bringUp.label,'Power-on test');assert.deepEqual(bringUp.fields.map(f=>f.key),profile.sections.find(s=>s.key==='bring-up').fields.map(f=>f.key));
 assert.deepEqual(record,before);assert.ok(validTemplate(record),'records keep the structure they were written with');
});

test('an upgrade updates unit, format and uncertainty only where the author left the shipped value',async()=>{
 const {shippedProperties,profileUpgradeReview}=await import('../src/web/laboratory/catalog.js');
 const {profileUpgradeSummary}=await import('../src/web/laboratory/profile-text.js');
 const beekeeping=laboratoryProfiles.find(p=>p.id==='beekeeping'),lab={profiles:[],sections:[]};
 assert.deepEqual(shippedProperties(beekeeping,'inspection','temperature',1),{unit:'°C',format:null,uncertainty:null});
 assert.deepEqual(shippedProperties(beekeeping,'inspection','temperature',2),{unit:'°C',format:null,uncertainty:'absolute'});
 enableProfile(lab,'beekeeping',true);lab.profiles[0].version=1;
 const field=(section,key)=>lab.sections.find(s=>s.key===section).fields.find(f=>f.key===key);
 for(const [section,key] of [['inspection','temperature'],['harvest','mass'],['harvest','moisture']])delete field(section,key).uncertainty;
 field('harvest','moisture').uncertainty='interval';field('harvest','mass').type='text';delete field('harvest','mass').numeric;
 const plan=profileUpgrade(beekeeping,1);
 assert.deepEqual(plan.changes.map(c=>c.section+'/'+c.field+':'+c.property).sort(),['harvest/mass:uncertainty','harvest/moisture:uncertainty','inspection/temperature:uncertainty']);
 const review=profileUpgradeReview(plan,(section,key)=>field(section,key));
 assert.deepEqual(review.apply.map(c=>c.field),['temperature']);assert.deepEqual(review.kept.map(c=>c.field).sort(),['mass','moisture']);
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const {profileUpgradeChangeText,profileUpgradeKeptText}=await import('../src/web/laboratory/profile-text.js'),html=profileUpgradeSummary(plan,review,esc);
 for(const change of review.apply)assert.ok(html.includes(esc(profileUpgradeChangeText(plan,change))));
 for(const change of review.kept)assert.ok(html.includes(esc(profileUpgradeKeptText(plan,change))));
 assert.ok(upgradeProfile(lab,'beekeeping'));assert.ok(validConfiguration(lab));
 assert.equal(field('inspection','temperature').uncertainty,'absolute');assert.equal(field('harvest','moisture').uncertainty,'interval');
 assert.equal(field('harvest','mass').type,'text');assert.equal(Object.hasOwn(field('harvest','mass'),'uncertainty'),false,'a field whose type the author changed is left alone');
});
