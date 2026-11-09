import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {websiteCSSByteLimit} from './web/website-css-urls.js';
import {generatedAppearanceProperties} from './web/website-files-visual-style.js';
import {defaultBreakpoints,parseLayoutLine} from './web/website-breakpoint-model.js';

const identity = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const marker = new RegExp('\\n/\\* Observanda (appearance|layout) (ow-(?:visual|layout)-'+identity+') \\*/\\n', 'g');
const area = new RegExp('\\bowarea-'+identity+'\\b', 'g');
const layoutProperties = new Set(('display visibility order flex-direction flex-wrap grid-template-columns grid-template-areas grid-area grid-column grid-row grid-auto-flow align-items align-content justify-content align-self justify-self text-align gap padding width height box-sizing min-width max-width flex-basis flex-grow border-width border-style border-color border-radius position top right bottom left z-index margin background-color color').split(' '));

function admittedDeclarations(body,properties,layoutPriority=false){
 // CSSOM quotes family names and grid-area rows. Delimiters inside those
 // strings are data, including parentheses, braces and semicolons in a font.
 const masked=body.replace(/"(?:[^"\\\n\r]|\\[^\n\r])*"|'(?:[^'\\\n\r]|\\[^\n\r])*'/g,'""');
 return masked.split(';').every(declaration=>{
  if(!declaration.trim())return true;
  const value=layoutPriority?declaration.replace(/\s*!important\s*$/i,''):declaration;
  const match=/^\s*([\w-]+)\s*:\s*([^:;{}@\\!\n]+?)\s*$/.exec(value);
  if(!match||!properties.has(match[1])||/[<>']|\/\*|\*\//.test(match[2]))return false;
  if(match[2].includes('"')&&(!['font-family','--heading-font','--reading-font','grid-template-areas'].includes(match[1])||match[2].replaceAll('""','').includes('"')))return false;
  return [...match[2].matchAll(/([\w-]+)\s*\(/g)].every(([,fn])=>['rgb','rgba','repeat','minmax','min','max','clamp','calc'].includes(fn));
 });
}

function layoutRule(css,at,name,ranges){
 const end='\n/* End Observanda layout '+name+' */\n';
 const seen=new Set();
 while(seen.size<=ranges.length){
  const stop=css.indexOf('\n',at);if(stop<0)return null;
  const line=css.slice(at,stop);
  const rule=parseLayoutLine(line,name,ranges);
  if(!rule||seen.has(rule.id)||!admittedDeclarations(rule.body,layoutProperties,true))return null;
  seen.add(rule.id);
  if(css.startsWith(end,stop))return stop+end.length;
  at=stop+1;
 }
 return null;
}

// Only exact, editor-owned rule blocks attached to an eligible element are
// copied. Other selectors or resources in the public stylesheet stay untouched.
export function designStyleCopies(css,ranges=defaultBreakpoints()){
 const rules=new Map(),areas=new Map();
 let size=Buffer.byteLength(css);
 for(const match of css.matchAll(marker)){
  const [,kind,name]=match,at=match.index+match[0].length;
  let stop=null;
  if(kind==='layout'&&name.startsWith('ow-layout-'))stop=layoutRule(css,at,name,ranges);
  if(kind==='appearance'&&name.startsWith('ow-visual-')){
   const prefix='.'+name+' {',nextLine=css.indexOf('\n',at);
   const line=css.slice(at,nextLine<0?undefined:nextLine);
   if(line.startsWith(prefix)){
    const body=/^((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^}"'])*?)\}/.exec(line.slice(prefix.length));
    if(body&&admittedDeclarations(body[1],generatedAppearanceProperties))stop=at+prefix.length+body[0].length;
   }
  }
  rules.set(name,rules.has(name)||stop===null?null:{text:css.slice(match.index,stop),start:match.index,stop,copies:[]});
 }
 return {
  admittedRules(classes){
   const included=[];let at=0;
   for(const [name,rule] of rules){
    if(!rule||css.slice(at,rule.start).trim())return null;
    if(classes.has(name))included.push(rule.text);
    at=rule.stop;
   }
   return css.slice(at).trim()?null:included;
  },
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
  },
  copiedRules(structuralClasses){
   const selected=[...rules.values()].filter(rule=>rule?.copies.length);
   return selected.map((rule,i)=>rule.copies.join('')+
    designCascade(css.slice(rule.stop,selected[i+1]?.start),structuralClasses)).join('');
  }
 };
}

// The copied stylesheet follows the common stylesheet. Replay later ordinary
// typography/layout declarations on admitted structural selectors at their
// original positions among cloned rules. Source-specific IDs, generated classes,
// copy text and URL-bearing declarations never enter the new page stylesheet.
const sharedProperties=new Set([...generatedAppearanceProperties,...layoutProperties]);
const structuralTags=new Set('html body main section article aside div h1 h2 h3 h4 h5 h6 p blockquote details summary ol ul li dl dt dd figure figcaption table caption thead tbody tfoot tr th td span strong em b i u sub sup mark code pre hr a img audio video'.split(' '));
const cssTokens=/(?:\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\[\s\S])*(?:"|$)|'(?:[^'\\]|\\[\s\S])*(?:'|$)|\\[\s\S]|[{};])/g;
function structuralSelector(selector,classes){
 if(!selector||!/^[a-z\d_.*,+>~\s-]+$/i.test(selector))return false;
 return [...selector.matchAll(/\.?[-\w]+/g)].every(([name])=>name.startsWith('.')?classes.has(name.slice(1)):structuralTags.has(name.toLowerCase()));
}
function designCascade(text,classes){
 const output=[],frames=[{kind:'group',open:'',emitted:false}],tokens=new RegExp(cssTokens.source,'g');
 let start=0;
 function declaration(parent,stop){
  const value=text.slice(start,stop).trim();
  if(!value||!admittedDeclarations(value,sharedProperties))return;
  if(!parent.emitted){
   for(const frame of frames)if(frame.open&&!frame.emitted){output.push(frame.open,'{');frame.emitted=true;}
  }
  output.push(value,';');
 }
 for(const {0:token,index} of text.matchAll(tokens)){
  const parent=frames.at(-1);
  if(token==='{'){
   const prelude=text.slice(start,index).replace(/\/\*[\s\S]*?\*\//g,'').trim();
   const group=parent?.kind==='group';
   const kind=group&&/^@media\s+[\s\w():.,%-]+$/i.test(prelude)?'group':
    group&&structuralSelector(prelude,classes)?'rule':'skip';
   frames.push({kind,open:prelude,emitted:false});start=index+1;
  }else if(token===';'||token==='}'){
   if(parent?.kind==='rule')declaration(parent,index);
   if(token==='}'&&frames.length>1){if(parent.emitted)output.push('}');frames.pop();}
   start=index+1;
  }
 }
 return output.join('');
}
