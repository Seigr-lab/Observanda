import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {websiteCSSByteLimit} from './web/website-css-urls.js';
import {generatedAppearanceProperties} from './web/website-files-visual-style.js';

const identity = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const marker = new RegExp('\\n/\\* Observanda (appearance|layout) (ow-(?:visual|layout)-'+identity+') \\*/\\n', 'g');
const area = new RegExp('\\bowarea-'+identity+'\\b', 'g');
const layoutProperties = new Set(('display flex-direction flex-wrap grid-template-columns grid-template-areas grid-area grid-column grid-row grid-auto-flow align-items justify-content gap padding width min-width max-width flex-basis flex-grow justify-self border-width border-style border-color border-radius position top right bottom left z-index margin background-color color').split(' '));

function admittedDeclarations(body,properties){
 // CSSOM quotes family names and grid-area rows. Delimiters inside those
 // strings are data, including parentheses, braces and semicolons in a font.
 const masked=body.replace(/"(?:[^"\\\n\r]|\\[^\n\r])*"|'(?:[^'\\\n\r]|\\[^\n\r])*'/g,'""');
 return masked.split(';').every(declaration=>{
  if(!declaration.trim())return true;
  const match=/^\s*([\w-]+)\s*:\s*([^:;{}@\\!\n]+?)\s*$/.exec(declaration);
  if(!match||!properties.has(match[1])||/[<>']|\/\*|\*\//.test(match[2]))return false;
  if(match[2].includes('"')&&(!['font-family','--heading-font','--reading-font','grid-template-areas'].includes(match[1])||match[2].replaceAll('""','').includes('"')))return false;
  return [...match[2].matchAll(/([\w-]+)\s*\(/g)].every(([,fn])=>['rgb','rgba','repeat','minmax','min','max','clamp','calc'].includes(fn));
 });
}

function layoutRule(css,at,name){
 const end='\n/* End Observanda layout '+name+' */\n';
 const selector='.'+name+'.'+name+' {', widths={desktop:null,tablet:900,phone:600};
 const seen=new Set();
 while(seen.size<3){
  const stop=css.indexOf('\n',at);if(stop<0)return null;
  const line=css.slice(at,stop);
  const view=/^\/\* (desktop|tablet|phone) \*\//.exec(line)?.[1];
  if(!view||seen.has(view))return null;
  seen.add(view);
  const width=widths[view],prefix='/* '+view+' */'+(width?'@media (max-width: '+width+'px) {':'')+selector,suffix=width?'}}':'}';
  if(!line.startsWith(prefix)||!line.endsWith(suffix)||!admittedDeclarations(line.slice(prefix.length,-suffix.length),layoutProperties))return null;
  if(css.startsWith(end,stop))return stop+end.length;
  at=stop+1;
 }
 return null;
}

// Only exact, editor-owned rule blocks attached to an eligible element are
// copied. Other selectors or resources in the public stylesheet stay untouched.
export function designStyleCopies(css){
 const rules=new Map(),areas=new Map();
 let size=Buffer.byteLength(css);
 for(const match of css.matchAll(marker)){
  const [,kind,name]=match,at=match.index+match[0].length;
  let stop=null;
  if(kind==='layout'&&name.startsWith('ow-layout-'))stop=layoutRule(css,at,name);
  if(kind==='appearance'&&name.startsWith('ow-visual-')){
   const prefix='.'+name+' {',nextLine=css.indexOf('\n',at);
   const line=css.slice(at,nextLine<0?undefined:nextLine);
   if(line.startsWith(prefix)){
    const body=/^((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^}"'])*?)\}/.exec(line.slice(prefix.length));
    if(body&&admittedDeclarations(body[1],generatedAppearanceProperties))stop=at+prefix.length+body[0].length;
   }
  }
  rules.set(name,rules.has(name)||stop===null?null:{text:css.slice(match.index,stop),stop,copies:[]});
 }
 return {
  copy(name){
   const rule=rules.get(name);if(!rule)return null;
   const next=name.slice(0,-36)+randomUUID();
   size+=Buffer.byteLength(rule.text);if(size>websiteCSSByteLimit)throw new AppError('LIMIT');
   const headerEnd=rule.text.indexOf('{');
   const clone=name.startsWith('ow-visual-')?rule.text.slice(0,headerEnd).replaceAll(name,next)+rule.text.slice(headerEnd):rule.text.replaceAll(name,next).replace(area,id=>{
    if(!areas.has(id))areas.set(id,'owarea-'+randomUUID());
    return areas.get(id);
   });
   rule.copies.push(clone);return next;
  },
  stylesheet(){
   const output=[];let offset=0;
   for(const rule of rules.values()){
    if(!rule?.copies.length)continue;
    output.push(css.slice(offset,rule.stop),rule.copies.join(''));offset=rule.stop;
   }
   return output.join('')+css.slice(offset);
  }
 };
}
