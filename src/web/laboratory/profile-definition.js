import english from '../locales/en/labBookProfiles.json' with {type:'json'};
import types from '../locales/en/labBookTypes.json' with {type:'json'};

// A profile names its sections, fields, choices and units by catalogue key.
// The English catalogue holds the canonical text that enabling a profile copies
// into a lab book configuration, and that records keep in their template;
// interfaces translate it when they display it (profile-text.js). Released
// English text is therefore part of the profile version: change it only in a
// new version, never in place, or existing books stop recognizing it.
const say=key=>{if(typeof english[key]!=='string')throw new TypeError('Missing lab book profile text: '+key);return english[key];};
// A unit names a word that translates; symbols such as kg, % or °C stay literal.
export const unit=id=>({unit:id});
const field=(key,type,{unit:measure='',choices=[]}={})=>({key,type,unit:measure,choices});
export const text=key=>field(key,'text');
export const date=key=>field(key,'date');
export const number=(key,measure='')=>field(key,'number',{unit:measure});
export const select=(key,choices)=>field(key,'select',{choices});
export const section=(key,fields)=>({key,fields});

export function defineProfile({id,version,icon,tracking=null,sections}){
 const unitText=measure=>typeof measure==='object'?say('units.'+measure.unit):measure;
 const built=sections.map(s=>({key:s.key,label:say(`${id}.${s.key}.label`),description:say(`${id}.${s.key}.description`),fields:s.fields.map(f=>({
  key:f.key,label:say(`${id}.${s.key}.fields.${f.key}`),type:f.type,unit:unitText(f.unit),required:false,
  choices:f.choices.map(choice=>say(`${id}.${s.key}.choices.${f.key}.${choice}`))
 }))}));
 const keys=new Set(built.map(s=>s.key));
 if(tracking&&![...tracking.subjects,...tracking.events,tracking.primary].every(key=>keys.has(key)))throw new TypeError('Profile tracking names an unknown section: '+id);
 return {id,version,label:types[id+'.label'],description:types[id+'.description'],icon,
  tracking:tracking&&{...tracking,subjectLabel:say(id+'.tracking.subject'),primaryLabel:say(id+'.tracking.primary'),headings:Object.fromEntries(tracking.subjects.map(key=>[key,say(`${id}.tracking.history.${key}`)]))},
  sections:built};
}
