import {readFile} from 'node:fs/promises';
import {LANGUAGES,validateCatalogue,placeholders} from '../src/web/i18n/runtime.js';
import {validateGuide,guideWithMessages,mergeGuide} from '../src/web/help/model.js';
import {MESSAGE_NAMESPACES,catalogueLanguages,t,prepareNamespaces} from '../src/web/i18n/index.js';
const resource=async(locale,name)=>JSON.parse(await readFile(new URL('../src/web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8'));
// This is the package contract: adding a language is a manifest/resource change,
// not another UI renderer. Record/template content is not part of this catalogue.
export async function checkLocales(){
 await prepareNamespaces(MESSAGE_NAMESPACES);
 const ids=new Set();
 for(const item of LANGUAGES){
  if(!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?$/.test(item.id)||ids.has(item.id)||!['ltr','rtl'].includes(item.direction)||typeof item.name!=='string'||!item.name.trim())throw new Error('Invalid language manifest');
  ids.add(item.id);
 }
 if(!ids.has('en'))throw new Error('English fallback missing');
 const baseGuide=validateGuide(await resource('en','guide')),anchors=guide=>JSON.stringify(guide.topics.map(t=>[t.id,t.sections.map(s=>s.id)]));
 for(const namespace of MESSAGE_NAMESPACES){
  const available=catalogueLanguages(namespace);if(!available.includes('en')||new Set(available).size!==available.length||available.some(id=>!ids.has(id)))throw new Error('Invalid catalogue languages: '+namespace);
  const source=await resource('en',namespace);
  for(const locale of LANGUAGES.filter(l=>available.includes(l.id))){
   const catalogue=validateCatalogue(await resource(locale.id,namespace),source);
   if(JSON.stringify(Object.keys(catalogue).sort())!==JSON.stringify(Object.keys(source).sort()))throw new Error('Missing '+locale.id+'/'+namespace+' message keys');
   for(const value of Object.values(catalogue))for(const message of typeof value==='string'?[value]:Object.values(value)){
    if(!message.trim())throw new Error('Empty translation');placeholders(message);
   }
  }
 }
 for(const locale of LANGUAGES){const guide=mergeGuide(baseGuide,await resource(locale.id,'guide'),locale.id);guideWithMessages(guide,t);if(anchors(guide)!==anchors(baseGuide))throw new Error('Help anchors differ: '+locale.id);}
}
