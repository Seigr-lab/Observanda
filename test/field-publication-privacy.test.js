import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validFields} from '../src/web/custom-fields.js';
import {setCustomFieldProperty} from '../src/web/custom-field-numbers.js';
import {customFieldLabel,customFieldText} from '../src/web/custom-field-presentation.js';
import {sourcePublicationRecord} from '../src/web/source-publication-permissions.js';
import {laboratoryProfiles,enableProfile,upgradeProfile,profileUpgrade} from '../src/web/laboratory/catalog.js';
import {profileUpgradeItems} from '../src/web/laboratory/profile-text.js';
import {templateFrom,validConfiguration} from '../src/web/notebook-schema.js';
// Lab book profile text is a deferred catalogue; these checks read profiles directly.
import '../src/web/i18n/catalogues/labBookProfiles.js';

const field=(key,extra={})=>({key,label:key,type:'text',unit:'',required:false,choices:[],...extra});

test('a field marked never to publish leaves every output target with its value',()=>{
 assert.ok(validFields([field('site',{private:true})]));assert.equal(validFields([field('site',{private:false})]),false,'only true is stored');
 const record={id:'r',share:true,sharePdf:true,sections:[],attachments:[],body:'',contributors:[],tags:[],figures:[],relations:[],
  template:{id:'t',profileId:null,label:'Site',description:'',fields:[field('name'),field('coordinates',{private:true}),field('notes')],values:{name:'North meadow',coordinates:'59.1234, 10.5678',notes:'Open'}}};
 const before=structuredClone(record);
 for(const target of ['website','pdf']){
  const projected=sourcePublicationRecord(record,target);
  assert.deepEqual(projected.template.fields.map(f=>f.key),['name','notes']);assert.deepEqual(projected.template.values,{name:'North meadow',notes:'Open'});
  assert.ok(!JSON.stringify(projected).includes('59.1234'));
 }
 assert.deepEqual(record,before,'the original record is untouched');
 const withheld=sourcePublicationRecord({...record,publication:{website:{template:false}}},'website');assert.equal(withheld.template,undefined,'the record-level choice still withholds every field');
 const open={...record,template:{...record.template,fields:record.template.fields.filter(f=>!f.private),values:{name:'North meadow',notes:'Open'}}};
 assert.deepEqual(sourcePublicationRecord(open,'website').template,open.template,'records without private fields project as before');
});

test('authors mark and unmark a field, and its label says it is never published',()=>{
 const f=field('keeper');assert.equal(setCustomFieldProperty(f,'private',true),true);assert.equal(f.private,true);
 assert.equal(customFieldLabel(f),'keeper · '+customFieldText('privateMark'));
 assert.equal(setCustomFieldProperty(f,'private','yes'),false);assert.equal(setCustomFieldProperty(f,'private',false),true);assert.equal(Object.hasOwn(f,'private'),false);
});

test('profiles declare private fields, new books copy them and an upgrade adds the protection to older books',()=>{
 const environmental={profiles:[],sections:[]};enableProfile(environmental,'environmental-agricultural',true);
 const site=environmental.sections.find(s=>s.key==='sites');assert.equal(site.fields.find(f=>f.key==='precise-location').private,true);
 const occurrence=environmental.sections.find(s=>s.key==='occurrence');assert.ok(occurrence.fields.every(f=>!f.private),'occurrences stay publishable');
 const template=templateFrom(site);template.values={'precise-location':'59.1234, 10.5678','generalized-locality':'Southern county'};
 assert.ok(!JSON.stringify(sourcePublicationRecord({share:true,sections:[],attachments:[],template},'website')).includes('59.1234'));
 const beekeeping=laboratoryProfiles.find(p=>p.id==='beekeeping'),lab={profiles:[],sections:[]};
 enableProfile(lab,'beekeeping',true);lab.profiles[0].version=1;
 for(const s of lab.sections)for(const f of s.fields)delete f.private;
 const movement=lab.sections.find(s=>s.key==='movement');movement.fields=movement.fields.filter(f=>f.key!=='sender');
 const plan=profileUpgrade(beekeeping,1);assert.deepEqual(plan.private.map(p=>p.section+'/'+p.field).sort(),['apiary/keeper','apiary/site','movement/from','movement/recipient','movement/sender','movement/to']);
 assert.ok(profileUpgradeItems(plan).some(item=>item.endsWith('('+customFieldText('privateMark')+')')));
 assert.ok(upgradeProfile(lab,'beekeeping'));assert.ok(validConfiguration(lab));
 assert.deepEqual(lab.sections.flatMap(s=>s.fields.filter(f=>f.private).map(f=>s.key+'/'+f.key)).sort(),['apiary/keeper','apiary/site','movement/from','movement/recipient','movement/to']);
 assert.ok(!movement.fields.some(f=>f.key==='sender'),'a removed field is not brought back');
});
