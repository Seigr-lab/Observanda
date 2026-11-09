import {websiteCSSByteLimit} from './website-css-urls.js';

// Native text controls address LF text. Files and parse5 diagnostics use the
// original spelling, including mixed Windows/Unix endings in one document.
export const fieldSourceText=source=>source.includes('\r')?source.replace(/\r\n?/g,'\n'):source;
export function fieldSourceOffset(raw,offset){
 let removed=0;
 for(let at=raw.indexOf('\r\n');at>=0&&at<offset;at=raw.indexOf('\r\n',at+2))removed++;
 return offset-removed;
}
export function rawSourceOffset(raw,offset){
 let result=offset;
 for(let at=raw.indexOf('\r\n');at>=0&&at<result;at=raw.indexOf('\r\n',at+2))result++;
 return result;
}
export function editedSourceText(raw,text){
 if(!raw.includes('\r'))return text;
 const original=fieldSourceText(raw);if(original===text)return raw;
 let start=0,tail=0;
 while(start<original.length&&start<text.length&&original[start]===text[start])start++;
 while(tail<original.length-start&&tail<text.length-start&&original[original.length-tail-1]===text[text.length-tail-1])tail++;
 const from=rawSourceOffset(raw,start),to=rawSourceOffset(raw,original.length-tail),before=raw.slice(0,from),after=raw.slice(to);
 const last=Math.max(before.lastIndexOf('\r'),before.lastIndexOf('\n'));
 const newline=last<0?(raw.match(/\r\n|\r|\n/)?.[0]??'\n'):
  before[last]==='\n'&&before[last-1]==='\r'?'\r\n':before[last];
 return before+text.slice(start,text.length-tail).replace(/\n/g,newline)+after;
}

const htmlTokens=/<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][\w:.-]*|\/?>|[\w:.-]+(?=\s*=)|"[^"]*(?:"|$)|'[^']*(?:'|$)|&(?:#\d+|#x[\da-f]+|[a-z]\w*);/gi;
const cssTokens=/\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|@[-\w]+|--?[\w-]+(?=\s*:)|[\w-]+(?=\s*:)|#[\w-]+|(?:\d*\.)?\d+(?:%|[a-z]+)?|[{}:;]/gi;
export function sourceHighlight(text,kind,escape){
 let result='',offset=0;
 for(const m of text.matchAll(kind==='html'?htmlTokens:cssTokens)){
  const s=m[0],type=/^data-(?:observanda-(?:source|link|part)|website-(?:feed|instance|source-gallery|menu))/.test(s)?'managed':
   s.startsWith('<!--')||s.startsWith('/*')?'comment':/^["']/.test(s)?'string':
   /^[<&/>@{}:;]/.test(s)?'markup':/^[#.\d]/.test(s)?'value':'name';
  result+=escape(text.slice(offset,m.index))+'<span class="source-'+type+'">'+escape(s)+'</span>';offset=m.index+s.length;
 }
 return result+escape(text.slice(offset));
}
export function sourceLines(text){
 const lines=[0];for(let at=text.indexOf('\n');at!==-1;at=text.indexOf('\n',at+1))lines.push(at+1);return lines;
}
export function sourcePoint(lines,offset){
 let lo=0,hi=lines.length;
 while(lo+1<hi){const mid=Math.floor((lo+hi)/2);if(lines[mid]<=offset)lo=mid;else hi=mid;}
 return {line:lo+1,column:offset-lines[lo]+1};
}
export function cssStructureIssue(text){
 let stack=new Uint32Array(32),depth=0,quote='',at=0,comment=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(comment){if(c==='*'&&text[i+1]==='/'){comment=false;i++;}continue;}
  if(c==='\\'){if(text[i+1]==='\r'&&text[i+2]==='\n')i++;i++;continue;}
  if(quote){if(c===quote){quote='';continue;}if(/[\r\n\f]/.test(c))return {start:at,end:i,reason:'cssString'};continue;}
  if(c==='/'&&text[i+1]==='*'){comment=true;at=i;i++;continue;}
  if(c==='"'||c==="'"){quote=c;at=i;continue;}
  if(c==='('||c==='{'||c==='['){
   if(depth===stack.length){const next=new Uint32Array(depth*2);next.set(stack);stack=next;}
   stack[depth++]=i;continue;
  }
  if(c===')'||c==='}'||c===']'){
   if(!depth||text[stack[--depth]]!==({')':'(','}':'{',']':'['})[c])return {start:i,end:i+1,reason:'cssDelimiter'};
  }
 }
 if(comment||quote)return {start:at,end:at+(comment?2:1),reason:comment?'cssComment':'cssString'};
 if(depth){const start=stack[depth-1];return {start,end:start+1,reason:'cssDelimiter'};}
 return null;
}
const cssParts=/\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|\\(?:[\da-f]{1,6}\s?|[\s\S])|[()[\]{};]/gi;
function cssBoundaries(text,callback){
 let grouped=0;
 for(const token of text.matchAll(cssParts)){
  const c=token[0];
  if(c==='('||c==='[')grouped++;
  else if(c===')'||c===']')grouped=Math.max(0,grouped-1);
  else if(!grouped&&c.length===1)callback(c,token.index);
 }
}
export function styleSelectorAt(text,offset){
 let start=0,previous=null;const scopes=[];
 cssBoundaries(text.slice(0,offset),(c,i)=>{
  if(c==='{'){scopes.push(text.slice(start,i).trim());start=i+1;}
  else if(c==='}'){const last=scopes.pop();if(last&&!last.startsWith('@'))previous=last;start=i+1;}
  else if(c===';')start=i+1;
 });
 return scopes.findLast(s=>s&&!s.startsWith('@'))??(!text.slice(start,offset).trim()?previous:null);
}
// Format token boundaries only. HTML character data, preformatted samples,
// entities, comments, quoted attribute values and CSS strings remain verbatim.
const htmlTags=/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<[a-z][\w:.-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
export function formatWebsiteSource(text,kind){
 if(kind==='html')return text.replace(htmlTags,(tag,raw)=>{
  if(raw||tag.startsWith('<!--'))return tag;
  // Attribute-value whitespace (quoted or immediately after "=") is content.
  const attrs=/\s+([^\s="'<>/]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=\x60<>]+))?/g;
  let attributes=0;const formatted=tag.replace(attrs,(_,name,value='')=>{attributes++;return '\n  '+name+value;});
  return attributes>1?formatted:tag;
 });
 let last=0,depth=0,length=0,overflow=false;const chunks=[];
 cssBoundaries(text,(c,at)=>{
  if(overflow)return;
  if(c==='}')depth=Math.max(0,depth-1);
  const part=text.slice(last,at);
  if(c==='}'&&part.trim()&&chunks.length)chunks.push(part,'\n','  '.repeat(Math.min(depth,32)),c);
  else chunks.push(part,c);
  if(c==='{')depth++;
  last=at+1;
  while(last<text.length&&/\s/.test(text[last]))last++;
  const next=text[last];if(next!==undefined)chunks.push('\n','  '.repeat(Math.min(next==='}'?Math.max(depth-1,0):depth,32)));
  // In a deeply nested minified file, added indentation can dwarf the input.
  length+=part.length+2+2*Math.min(depth,32)+(c==='}'&&part.trim()?1+2*Math.min(depth,32):0);
  overflow=length>websiteCSSByteLimit;
 });
 if(overflow)return null;
 chunks.push(text.slice(last));return chunks.join('');
}
