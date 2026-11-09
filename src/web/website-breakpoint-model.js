import {tokenID} from './website-token-model.js';
export const websiteLayoutWidths=Object.freeze({desktop:null,tablet:900,phone:600});
export const defaultBreakpoints=()=>Object.entries(websiteLayoutWidths).filter(([,max])=>max!==null).map(([id,max])=>({id,name:'',min:null,max}));
const builtin=id=>id==='tablet'||id==='phone';
const bound=value=>value===null||Number.isSafeInteger(value)&&value>=1&&value<=16384;
export function validBreakpoints(ranges){
 if(!Array.isArray(ranges))return false;
 const seen=new Set(),names=new Set();
 for(const range of ranges){
  if(!range||Object.keys(range).sort().join()!=='id,max,min,name'||(!builtin(range.id)&&!tokenID(range.id))||seen.has(range.id))return false;
  if(!bound(range.min)||!bound(range.max)||(range.min===null&&range.max===null)||(range.min!==null&&range.max!==null&&range.min>range.max))return false;
  if(builtin(range.id)){
   if(range.min!==null||range.max!==websiteLayoutWidths[range.id]||range.name!=='')return false;
  }else{
   if(typeof range.name!=='string'||!range.name.trim()||range.name.length>160||/[\u0000-\u001f]/u.test(range.name))return false;
   const key=range.name.trim().normalize('NFC').toLowerCase();if(names.has(key))return false;names.add(key);
  }
  seen.add(range.id);
 }
 return seen.has('tablet')&&seen.has('phone');
}
export const matchesWidth=(range,width)=>(range.min===null||width>=range.min)&&(range.max===null||width<=range.max);
export function breakpointMedia(range){
 return [range.min===null?null:'(min-width: '+range.min+'px)',range.max===null?null:'(max-width: '+range.max+'px)'].filter(Boolean).join(' and ');
}
export function breakpointLabel(range,t){return range.id==='desktop'?t('layoutDesktop'):builtin(range.id)?t(range.id):range.name;}
export function breakpointCondition(range){
 if(range.min===null)return '≤ '+range.max+' px';
 if(range.max===null)return '≥ '+range.min+' px';
 return range.min+'–'+range.max+' px';
}
export function layoutLine(name,id,declaration,ranges){
 const range=id==='desktop'?null:ranges.find(r=>r.id===id);
 if(id!=='desktop'&&!range)throw TypeError('Unknown layout range');
 const selector=name==='site'?'body':'.'+name+'.'+name,rule=selector+' {'+declaration+'}';
 return '/* '+id+' */'+(range?'@media '+breakpointMedia(range)+' {'+rule+'}':rule);
}
export function parseLayoutLine(line,name,ranges){
 const id=/^\/\* ([a-z\d-]+) \*\//.exec(line)?.[1];
 if(!id||id!=='desktop'&&!ranges.some(range=>range.id===id))return null;
 const empty=layoutLine(name,id,'',ranges),at=empty.indexOf('{}')+1;
 const start=empty.slice(0,at),end=empty.slice(at);
 if(!line.startsWith(start)||!line.endsWith(end))return null;
 const body=line.slice(start.length,-end.length);
 if(/[{}\r\n]/.test(body))return null;
 return {id,body};
}
export function orderedLayoutLines(declarations,name,ranges){
 return ['desktop',...ranges.map(r=>r.id)].filter(id=>declarations.has(id)).map(id=>layoutLine(name,id,declarations.get(id),ranges)).join('\n');
}

const managedStart=/\/\* Observanda layout (site|ow-layout-[a-f0-9-]{36}) \*\/\n/y;
export const layoutStart=name=>'\n/* Observanda layout '+name+' */\n';
export const layoutEnd=name=>'\n/* End Observanda layout '+name+' */\n';

// Recognize complete editor blocks at stylesheet level. A marker embedded in
// an author's quoted text, comment, media query or container rule is literal.
export function managedLayoutBlocks(css){
 const blocks=new Map();if(!css.includes('/* Observanda layout '))return blocks;
 let depth=0;
 for(let i=0;i<css.length;i++){
  const char=css[i];
  if(char==='\\'){i++;continue;}
  if(char==='"'||char==="'"){
   while(++i<css.length){if(css[i]==='\\')i++;else if(css[i]===char||/[\r\n\f]/.test(css[i]))break;}continue;
  }
  if(char==='{'){depth++;continue;}if(char==='}'){depth=Math.max(0,depth-1);continue;}
  if(char!=='/'||css[i+1]!=='*')continue;
  if(!depth&&i>0&&css[i-1]==='\n'){
   managedStart.lastIndex=i;const match=managedStart.exec(css);
   if(match){
    const from=i-1,end=layoutEnd(match[1]),at=css.indexOf(end,managedStart.lastIndex);
    if(at===-1||blocks.has(match[1]))throw TypeError('Ambiguous layout block');
    const to=at+end.length,body=css.slice(managedStart.lastIndex,at);
    if(body.includes('\n/* Observanda layout '))throw TypeError('Nested layout block');
    blocks.set(match[1],{name:match[1],from,to,body});i=to-1;continue;
   }
  }
  const end=css.indexOf('*/',i+2);if(end===-1)break;i=end+1;
 }
 return blocks;
}
export function layoutDeclarations(block,ranges){
 const found=new Map();
 for(const line of block.body.split('\n')){
  const parsed=parseLayoutLine(line,block.name,ranges);
  if(!parsed||found.has(parsed.id))return null;
  found.set(parsed.id,parsed.body);
 }
 return found;
}
export function rewriteLayoutRanges(css,before,after,blocks){
 const parts=[];let from=0,manual=false;
 for(const block of blocks.values()){
  const declarations=layoutDeclarations(block,before);if(!declarations){manual=true;continue;}
  const lines=orderedLayoutLines(declarations,block.name,after);
  const next=lines?layoutStart(block.name)+lines+layoutEnd(block.name):'';
  if(css.slice(block.from,block.to)===next)continue;
  parts.push(css.slice(from,block.from),next);from=block.to;
 }
 return {css:parts.length?parts.join('')+css.slice(from):css,manual};
}
