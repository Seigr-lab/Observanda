import {attr,descendants} from './website-migration-views.js';
import {RECORD_TYPES,STATUSES} from './web/record-types.js';

const kinds=['body','outcome','results','contributors','attempt','tags','text'];
const boundaries=new Set('p div article section h1 h2 h3 h4 h5 h6 li ul ol dl dt dd blockquote pre figure figcaption tr caption br'.split(' '));
const skip=new Set('script style template noscript nav button select textarea svg annotation annotation-xml'.split(' '));
const paragraphLimit=12,paragraphBytes=480,overviewBytes=4096;
const hidden=node=>skip.has(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true');
const part=node=>attr(node,'data-observanda-part');

function shorten(value,limit){
 if(Buffer.byteLength(value)<=limit)return value;
 let end=0,bytes=3;
 for(const char of value){const next=Buffer.byteLength(char);if(bytes+next>limit)break;bytes+=next;end+=char.length;}
 return value.slice(0,end).trimEnd()+'…';
}
function plainLabel(node){
 if(!node||hidden(node)||!node.childNodes?.every(child=>child.nodeName==='#text'))return null;
 const label=node.childNodes.map(child=>child.value).join('').trim();return label.length<=100?label:null;
}
export function projectedRecordMetadata(fragment){
 const result={recordType:null,displayDate:null,status:null};
 for(const node of descendants(fragment)){
  if(part(node)!=='metadata')continue;
  let excluded=false;
  for(let parent=node;parent;parent=parent.parentNode)if(hidden(parent)||part(parent)?.startsWith('section:')){excluded=true;break;}
  if(excluded)continue;
  const children=(node.childNodes??[]).filter(child=>child.tagName&&!hidden(child));
  const typeNode=children[0],statusNode=children.at(-1),type=plainLabel(typeNode),status=plainLabel(statusNode);
  if(typeNode?.tagName==='span'&&RECORD_TYPES.some(t=>t.id===type))result.recordType=type;
  if(statusNode!==typeNode&&statusNode?.tagName==='span'&&STATUSES.includes(status))result.status=status;
  for(const child of children){
   const date=attr(child,'datetime');
   if(child.tagName==='time'&&typeof date==='string'&&date.length<=40&&/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(date)){result.displayDate=date;break;}
   if(child.tagName==='span'&&attr(child,'class')==='record-date'){
    const label=plainLabel(child);if(label&&/\d{4}/.test(label))result.displayDate=label;
   }
  }
  break;
 }
 return result;
}

// Read rendered text only. Nested section, figure and media parts have their
// own identity. They never supply a second copy of the overview text.
export function projectedSourceOverview(fragment,title){
 const groups=new Map(kinds.map(kind=>[kind,[]]));
 let writing='',current='text';
 function flush(){
  const value=writing.trim();writing='';
  if(!value||current==='text'&&value===title||groups.get(current).length>=paragraphLimit)return;
  groups.get(current).push(shorten(value,paragraphBytes));
 }
 function visit(node){
  if(hidden(node))return;
  const marker=part(node),before=current;
  if(marker!==undefined){
   flush();
   if(!groups.has(marker)||marker==='text')return;
   current=marker;
  }
  if(boundaries.has(node.tagName))flush();
  if(node.nodeName==='#text'&&writing.length<=paragraphBytes){
   let value=node.value.replace(/\s+/gu,' ');if(!writing||writing.endsWith(' '))value=value.trimStart();
   writing+=value.slice(0,paragraphBytes+1-writing.length);
  }else if((node.tagName==='td'||node.tagName==='th')&&writing&&!writing.endsWith(' ')&&writing.length<=paragraphBytes)writing+=' ';
  if(current==='outcome'&&node.tagName==='strong'&&plainLabel(node)==='Outcome:')return;
  for(const child of node.childNodes??[])visit(child);
  if(boundaries.has(node.tagName)||marker!==undefined)flush();
  current=before;
 }
 visit(fragment);flush();
 // Keep one paragraph from each available semantic part before allocating
 // more room to long prose. Older unmarked prose is a fallback only when
 // the page has no visible writing in a recognized part.
 if(kinds.some(kind=>kind!=='text'&&groups.get(kind).length))groups.delete('text');
 const overview=new Map();let remaining=overviewBytes,count=0;
 for(let i=0;i<paragraphLimit;i++)for(const [kind,paragraphs] of groups){
  if(!paragraphs[i]||remaining<16||count>=paragraphLimit)continue;
  const value=shorten(paragraphs[i],remaining);
  if(!overview.has(kind))overview.set(kind,{kind,paragraphs:[]});
  overview.get(kind).paragraphs.push(value);remaining-=Buffer.byteLength(value);count++;
 }
 return [...overview.values()];
}
