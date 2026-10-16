import {validLanguage} from '../i18n/runtime.js';
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
export function validateGuide(guide){
 if(!guide||!Array.isArray(guide.topics)||guide.topics.length>200)throw new TypeError('Invalid guide');
 const ids=new Set();
 for(const topic of guide.topics){
  if(!slug(topic.id)||topic.id==='all'||ids.has(topic.id)||!nonempty(topic.title)||!Array.isArray(topic.sections)||!topic.sections.length)throw new TypeError('Invalid guide topic');
  ids.add(topic.id);const sections=new Set();
  for(const section of topic.sections){
   if(!slug(section.id)||sections.has(section.id)||!nonempty(section.title)||!Array.isArray(section.paragraphs)||!section.paragraphs.length||section.paragraphs.some(p=>!nonempty(p)))throw new TypeError('Invalid guide section');
   sections.add(section.id);
  }
 }
 return guide;
}
const fold=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
// Documentation references the same control keys as the interface, so later
// translations cannot leave stale button names in otherwise translated prose.
export function guideWithMessages(guide,lookup){
 const text=value=>{
  const result=value.replace(/\{ui:([a-zA-Z][\w]*)\.([a-zA-Z][\w.-]*)\}/g,(_,namespace,key)=>lookup(namespace,key));
  if(result.includes('{ui:'))throw new TypeError('Invalid guide interface reference');
  return result;
 };
 return {topics:guide.topics.map(topic=>({...topic,title:text(topic.title),sections:topic.sections.map(section=>({...section,title:text(section.title),paragraphs:section.paragraphs.map(text)}))}))};
}
export function searchGuide(guide,query){
 const terms=fold(query.trim()).split(/\s+/u).filter(Boolean);if(!terms.length)return [];
 return guide.topics.flatMap(topic=>topic.sections.filter(section=>terms.every(term=>fold([topic.title,section.title,...section.paragraphs].join(' ')).includes(term))).map(section=>{
  const paragraph=section.paragraphs.find(p=>terms.some(term=>fold(p).includes(term)))??section.paragraphs[0];
  const match=fold(paragraph).indexOf(terms[0]),start=Math.max(0,match-70);
  return {topicId:topic.id,sectionId:section.id,title:topic.title,heading:section.title,snippet:(start?'…':'')+paragraph.slice(start,start+240)+(paragraph.length>start+240?'…':'')};
 }));
}
export const helpRoute=(topic=null,section=null)=>'#/preferences/help'+(topic?'/'+topic+(section?'/'+section:''):'');
export function resolveHelpRoute(hash){
 const parts=hash.replace(/^#\//,'').split('/');
 return parts[0]==='preferences'&&parts[1]==='help'&&parts.length<=4&&parts.slice(2).every(slug)?{page:'help',helpTopic:parts[2]??null,helpSection:parts[3]??null}:null;
}
export function mergeGuide(source,translation,locale){
 validateGuide(source);validateGuide(translation);
 for(const topic of translation.topics){const original=source.topics.find(t=>t.id===topic.id);if(!original||topic.sections.some(s=>!original.sections.some(o=>o.id===s.id)))throw new TypeError('Unknown translated guide anchor');}
 return {topics:source.topics.map(topic=>{
  const translated=translation.topics.find(t=>t.id===topic.id);
  return {...topic,title:translated?.title??topic.title,language:translated?locale:'en',sections:topic.sections.map(section=>{
   const value=translated?.sections.find(s=>s.id===section.id);return {...(value??section),language:value?locale:'en'};
  })};
 })};
}
export function guideLoader(fetcher=fetch){
 const cache=new Map();
 const read=async(locale,signal)=>{
  if(!validLanguage(locale))throw new TypeError('Unsupported guide language');
  if(cache.has(locale))return cache.get(locale);
  const response=await fetcher(new URL('../locales/'+locale+'/guide.json',import.meta.url),{signal});
  if(!response.ok)throw new Error('Guide unavailable');
  const guide=validateGuide(await response.json());cache.set(locale,guide);return guide;
 };
 return async(locale,{signal}={})=>{
  const guide=await read(locale,signal);return locale==='en'?guide:mergeGuide(await read('en',signal),guide,locale);
 };
}
