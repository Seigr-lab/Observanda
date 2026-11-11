import english from '../locales/en/labBookProfiles.json' with {type:'json'};
import types from '../locales/en/labBookTypes.json' with {type:'json'};

// A profile names its sections, fields, choices and units by catalogue key.
// The English catalogue holds the canonical text that enabling a profile copies
// into a lab book configuration, and that records keep in their template;
// interfaces translate it when they display it (profile-text.js). Released
// English text is therefore part of the profile version: change it only in a
// new version, never in place, or existing books stop recognizing it.
const say=key=>{if(typeof english[key]!=='string')throw new TypeError('Missing lab book profile text: '+key);return english[key];};
const since=value=>{if(!Number.isSafeInteger(value)||value<1)throw new TypeError('Invalid profile version');return value;};
// A unit names a word that translates; symbols such as kg, % or °C stay literal.
export const unit=id=>({unit:id});
// Options: since (the profile version that added the field); for text, an
// exact format (custom-field-formats.js) for identifiers and digests; for
// numbers, how the uncertainty is written (custom-field-uncertainty.js); and
// private (true, or the version that made it private), for personal data or
// precise locations that are never published.
const field=(key,type,{unit:measure='',choices=[],format=null,uncertainty=null,private:hidden=false,since:version=1}={})=>({key,type,unit:measure,choices,format,uncertainty,hidden:hidden===true?version:hidden===false?null:since(hidden),since:since(version)});
export const text=(key,options)=>field(key,'text',options);
export const date=(key,options)=>field(key,'date',options);
export const number=(key,measure='',options={})=>field(key,'number',{...options,unit:measure});
// Choices are ids, or {id,since} for a choice added by a later version.
export const select=(key,choices,options={})=>field(key,'select',{...options,choices});
export const section=(key,fields,{since:version=1}={})=>({key,fields,since:since(version)});

// `introduced` records the profile version that added each section, field and
// choice. An upgrade adds only what is newer than the book's version, so what an
// author removed after adopting it stays removed (catalog.js, upgradeProfile).
// `private` records the version from which a field is never published; an
// upgrade only ever adds that protection.
export function defineProfile({id,version,icon,tracking=null,sections}){
 since(version);
 const introduced={sections:{},fields:{},choices:{},private:{}};
 const unitText=measure=>typeof measure==='object'?say('units.'+measure.unit):measure;
 const within=value=>{if(value>version)throw new TypeError('Profile item is newer than its profile: '+id);return value;};
 const built=sections.map(s=>{
  introduced.sections[s.key]=within(s.since);
  return {key:s.key,label:say(`${id}.${s.key}.label`),description:say(`${id}.${s.key}.description`),fields:s.fields.map(f=>{
   introduced.fields[s.key+'/'+f.key]=within(Math.max(f.since,s.since));
   if(f.hidden!==null)introduced.private[s.key+'/'+f.key]=within(Math.max(f.hidden,f.since,s.since));
   const choices=f.choices.map(choice=>{
    const item=typeof choice==='string'?{id:choice,since:1}:choice,value=say(`${id}.${s.key}.choices.${f.key}.${item.id}`);
    introduced.choices[s.key+'/'+f.key+'/'+value]=within(Math.max(since(item.since),f.since,s.since));
    return value;
   });
   return {key:f.key,label:say(`${id}.${s.key}.fields.${f.key}`),type:f.type,unit:unitText(f.unit),required:false,choices,...(f.format?{format:f.format}:{}),...(f.uncertainty?{uncertainty:f.uncertainty}:{}),...(f.hidden!==null?{private:true}:{})};
  })};
 });
 const keys=new Set(built.map(s=>s.key));
 if(tracking&&![...tracking.subjects,...tracking.events,tracking.primary].every(key=>keys.has(key)))throw new TypeError('Profile tracking names an unknown section: '+id);
 return {id,version,label:types[id+'.label'],description:types[id+'.description'],icon,
  tracking:tracking&&{...tracking,subjectLabel:say(id+'.tracking.subject'),primaryLabel:say(id+'.tracking.primary'),headings:Object.fromEntries(tracking.subjects.map(key=>[key,say(`${id}.tracking.history.${key}`)]))},
  sections:built,introduced};
}
