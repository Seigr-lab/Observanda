import {fontStack,validFont} from './font-catalogue.js';

// Keys are the actual CSS properties exposed by the visual inspector.
// Values never accept a URL, selector or unowned custom property.
export const tokenGroups={
 typography:['font-family','font-size','font-weight','line-height','letter-spacing','text-align'],
 color:['color','background-color','border-color'],
 spacing:['padding-block','padding-inline','margin-block','margin-inline','gap'],
 layout:['display','grid-template-columns','align-items','justify-content','max-width','min-width','aspect-ratio']
};
export const tokenStates=['normal','hover','focus-visible','active','disabled','print'];
const length=/^(?:0|(?:0|[1-9]\d{0,4})(?:\.\d{1,4})?(?:px|rem|em|ch|vw|vh|%))$/;
const signed=value=>length.test(value)||value.startsWith('-')&&length.test(value.slice(1));
const boundedLength=value=>length.test(value)||/^clamp\(([^(),]+),\s*([^(),]+),\s*([^(),]+)\)$/.test(value)&&value.slice(6,-1).split(',').every(v=>length.test(v.trim()));
export const tokenID=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function tokenValue(key,value){
 if(typeof value!=='string'||!value||value.length>128)return false;
 if(key==='font-family')return validFont(value)||['sans-serif','serif','monospace','system-ui'].includes(value);
 if(key==='font-weight')return /^\d{1,4}$/.test(value)&&Number(value)>=1&&Number(value)<=1000;
 if(key==='line-height')return boundedLength(value)||/^(?:[0-9]|10)(?:\.\d{1,4})?$/.test(value);
 if(key==='letter-spacing'||key==='margin-block'||key==='margin-inline')return signed(value);
 if(key==='text-align')return ['start','end','center','justify'].includes(value);
 if(['color','background-color','border-color'].includes(key))return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)||value==='transparent';
 if(key==='display')return ['block','inline-block','flex','inline-flex','grid','inline-grid','flow-root'].includes(value);
 if(key==='grid-template-columns')return /^repeat\(([1-9]|[1-9]\d),\s*minmax\(0,\s*1fr\)\)$/.test(value)||/^repeat\(auto-fit,\s*minmax\(min\(100%,\s*([^(),]+)\),\s*1fr\)\)$/.exec(value)?.slice(1).every(v=>length.test(v))===true;
 if(key==='align-items')return ['start','end','center','baseline','stretch'].includes(value);
 if(key==='justify-content')return ['start','end','center','space-between','space-around','space-evenly'].includes(value);
 if(key==='aspect-ratio')return /^([1-9]\d{0,3})\s*\/\s*([1-9]\d{0,3})$/.test(value);
 return ['font-size','padding-block','padding-inline','gap','max-width','min-width'].includes(key)&&boundedLength(value);
}
export function validToken(token){
 if(!token||!tokenID(token.id)||!tokenID(token.classId)||typeof token.name!=='string'||!token.name.trim()||token.name.length>160||!Object.hasOwn(tokenGroups,token.group))return false;
 const rules=token.rules;
 if(!rules||typeof rules!=='object'||Array.isArray(rules)||!Object.keys(rules).length)return false;
 return Object.entries(rules).every(([state,properties])=>tokenStates.includes(state)&&properties&&typeof properties==='object'&&!Array.isArray(properties)&&Object.keys(properties).length>0&&Object.entries(properties).every(([key,v])=>tokenGroups[token.group].includes(key)&&tokenValue(key,v)));
}
export const tokenClass=id=>'ow-token-'+id;
export function tokenSheet(token){
 if(!validToken(token))throw TypeError('Invalid page style');
 const scopes=['site','folder','page','element'];
 const rules=scope=>tokenStates.filter(key=>token.rules[key]).map(state=>{
  // Give folder and page assignments successively higher specificity. Element
  // assignments are local, while authored inline and exact class overrides
  // retain the ordinary CSS cascade.
  const attribute='[data-website-'+scope+'-styles~="'+token.classId+'"]';
  const selector=scope==='element'?'.'+tokenClass(token.classId):'body'+attribute.repeat(scopes.indexOf(scope)+1);
  const suffix=state==='print'||state==='normal'?'':state==='disabled'?':is(:disabled,[aria-disabled="true"])':':'+state;
  const declarations=Object.entries(token.rules[state]).map(([key,value])=>{
   const computed=key==='font-family'&&validFont(value)?fontStack(value):value;
   return key+': '+computed+';';
  });
  const rule=selector+(suffix?':where('+suffix+')':'')+' { '+declarations.join(' ')+' }';
  return state==='print'?'@media print { '+rule+' }':rule;
 }).join('\n');
 return scopes.map(rules).join('\n')+'\n';
}
