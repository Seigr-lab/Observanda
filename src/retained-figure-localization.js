// Preview language belongs to this request. It cannot select arbitrary files or
// change the process language used by another reader or a canonical export.
import {readFile} from 'node:fs/promises';
import {translator,validLanguage} from './web/i18n/runtime.js';
const namespaces=Object.freeze(['figureDisplay','figureHeatmap','figureMarkerArea','figureIntervals','figureComposition','figureObservations','measurementTransform','measurements','retainedFigureData']);
const cache=new Map();
export const validRetainedFigureLanguage=(command,{exporting=false}={})=>!Object.hasOwn(command??{},'language')||!exporting&&command.operation==='svg'&&validLanguage(command.language);
const catalogue=async(locale,name)=>{
 const value=JSON.parse(await readFile(new URL('./web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8'));
 for(const entry of Object.values(value))if(entry&&typeof entry==='object')Object.freeze(entry);
 return Object.freeze(value);
};
export async function retainedFigureTranslator(locale){
 if(!validLanguage(locale))throw new TypeError('Unsupported retained figure language');
 if(!cache.has(locale))cache.set(locale,(async()=>{
  const entries=await Promise.all(namespaces.map(async name=>{
   const fallback=await catalogue('en',name),messages=locale==='en'?fallback:await catalogue(locale,name);
   return [name,translator(locale,messages,fallback)];
  }));
  const messages=Object.freeze(Object.fromEntries(entries));
  return Object.freeze((namespace,key,parameters)=>{
   if(!Object.hasOwn(messages,namespace))throw new TypeError('Unsupported retained figure namespace');
   return messages[namespace](key,parameters);
  });
 })().catch(error=>{cache.delete(locale);throw error;}));
 return cache.get(locale);
}
