import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {laboratoryProfiles,enableProfile} from '../src/web/laboratory/catalog.js';
import {profileText,storedChoices,trackingText,isProfileText} from '../src/web/laboratory/profile-text.js';
import {customFieldLabel,customFieldValueText} from '../src/web/custom-field-presentation.js';
import {validConfiguration} from '../src/web/notebook-schema.js';

const resource=(locale,name)=>readFile(new URL('../src/web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8').then(JSON.parse);
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const languages=['ca','es','nb','nn'];

// Every catalogue key a profile uses, derived from the profile itself.
function profileKeys(profile,english){
 const keys=[];
 for(const s of profile.sections){
  keys.push(`${profile.id}.${s.key}.label`,`${profile.id}.${s.key}.description`);
  for(const f of s.fields){
   keys.push(`${profile.id}.${s.key}.fields.${f.key}`);
   const prefix=`${profile.id}.${s.key}.choices.${f.key}.`;
   for(const choice of f.choices)keys.push(Object.keys(english).find(key=>key.startsWith(prefix)&&english[key]===choice));
   if(f.unit&&isProfileText(f.unit))keys.push(Object.keys(english).find(key=>key.startsWith('units.')&&english[key]===f.unit));
  }
 }
 if(profile.tracking)keys.push(`${profile.id}.tracking.subject`,`${profile.id}.tracking.primary`,...profile.tracking.subjects.map(key=>`${profile.id}.tracking.history.${key}`));
 return keys;
}

test('every profile text comes from the catalogue, every catalogue entry is used and shared text translates consistently',async()=>{
 const english=await resource('en','labBookProfiles'),used=new Set();
 for(const profile of laboratoryProfiles)for(const key of profileKeys(profile,english)){assert.ok(key&&Object.hasOwn(english,key),profile.id+' '+key);used.add(key);}
 assert.deepEqual(Object.keys(english).filter(key=>!used.has(key)),[]);
 for(const locale of languages){
  const catalogue=await resource(locale,'labBookProfiles'),seen=new Map();
  assert.deepEqual(Object.keys(catalogue).sort(),Object.keys(english).sort());
  for(const [key,value] of Object.entries(english)){
   assert.ok(catalogue[key].trim()&&!/[{}]/.test(catalogue[key]),locale+' '+key);
   if(seen.has(value))assert.equal(catalogue[key],seen.get(value),locale+': one translation for "'+value+'"');else seen.set(value,catalogue[key]);
  }
 }
});

test('books keep the canonical text while every interface language displays it translated',async context=>{
 context.after(()=>activateLanguage('en'));
 const beekeeping=laboratoryProfiles.find(p=>p.id==='beekeeping'),inspection=beekeeping.sections.find(s=>s.key==='inspection');
 const queen=inspection.fields.find(f=>f.key==='queen'),temperature=inspection.fields.find(f=>f.key==='temperature'),frames=inspection.fields.find(f=>f.key==='bee-frames');
 for(const locale of ['en',...languages]){
  await load(locale);activateLanguage(locale);
  const configuration={profiles:[],sections:[]};enableProfile(configuration,'beekeeping',true);
  assert.ok(validConfiguration(configuration));
  const copied=configuration.sections.find(s=>s.key==='inspection');
  assert.equal(copied.label,inspection.label,'stored text never depends on the interface language');
  assert.equal(profileText(copied.label),t('labBookProfiles','beekeeping.inspection.label'));
  assert.equal(profileText(copied.description),t('labBookProfiles','beekeeping.inspection.description'));
  assert.equal(customFieldLabel(temperature),t('labBookProfiles','beekeeping.inspection.fields.temperature')+' (°C) · '+t('customFields','uncertainties.absolute'));
  assert.equal(customFieldLabel(frames),t('labBookProfiles','beekeeping.inspection.fields.bee-frames')+' ('+t('labBookProfiles','units.frame-equivalents')+')');
  assert.equal(customFieldValueText(queen,'Not seen'),t('labBookProfiles','beekeeping.inspection.choices.queen.not-seen'));
  assert.equal(customFieldValueText({type:'text'},'Not seen'),'Not seen','free text is never translated');
  assert.equal(profileText('My own <inspection>'),'My own <inspection>');
  // An edited list of displayed choices keeps the stored values records refer to.
  assert.deepEqual(storedChoices([...queen.choices.map(profileText),'Partly seen'],queen.choices),[...queen.choices,'Partly seen']);
  assert.equal(trackingText('beekeeping','history','hive'),t('labBookProfiles','beekeeping.tracking.history.hive'));
  if(locale!=='en')assert.notEqual(profileText(copied.label),copied.label);
 }
});
