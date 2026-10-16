// Catalogues contain plain text. Rendering owners escape HTML at the boundary.
import languages from '../locales/languages.json' with {type:'json'};
export const LANGUAGES=Object.freeze(languages.map(value=>Object.freeze({...value})));
export const validLanguage=id=>LANGUAGES.some(language=>language.id===id);
export function resolveLanguage(value){
 const id=String(value??'').toLowerCase().replaceAll('_','-').split('-')[0];
 return validLanguage(id)?id:'en';
}
export function placeholders(value){
 return [...new Set([...String(value).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match=>match[1]))].sort();
}
export function validateCatalogue(catalogue,reference=catalogue){
 if(!catalogue||Array.isArray(catalogue)||typeof catalogue!=='object')throw new TypeError('Invalid message catalogue');
 for(const [key,value] of Object.entries(catalogue)){
  if(!Object.hasOwn(reference,key))throw new TypeError('Unknown message key: '+key);
  const source=reference[key],plural=typeof source==='object'&&source!==null;
  if(plural){
   if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.other!=='string'||Object.keys(value).some(k=>!['zero','one','two','few','many','other'].includes(k)))throw new TypeError('Invalid plural message: '+key);
   for(const message of Object.values(value))if(typeof message!=='string'||placeholders(message).join(',')!==placeholders(source.other).join(','))throw new TypeError('Invalid message parameters: '+key);
  }else if(typeof value!=='string'||placeholders(value).join(',')!==placeholders(source).join(','))throw new TypeError('Invalid message parameters: '+key);
 }
 return catalogue;
}
export function translator(locale,catalogue,fallback=catalogue){
 validateCatalogue(catalogue,fallback);
 const rules=new Intl.PluralRules(locale);
 return (key,parameters={})=>{
  let value=Object.hasOwn(catalogue,key)?catalogue[key]:Object.hasOwn(fallback,key)?fallback[key]:undefined;
  if(value===undefined)throw new TypeError('Unknown message key: '+key);
  if(typeof value==='object'){
   if(typeof parameters.count!=='number'||!Number.isFinite(parameters.count))throw new TypeError('Missing plural count: '+key);
   value=value[rules.select(parameters.count)]??value.other;
  }
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(_,name)=>{
   if(!Object.hasOwn(parameters,name)||!['string','number'].includes(typeof parameters[name]))throw new TypeError('Missing message parameter: '+name);
   return String(parameters[name]);
  });
 };
}
