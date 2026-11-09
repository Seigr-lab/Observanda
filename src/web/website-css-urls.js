// Saved site stylesheets and the authoring review must resolve the same CSS
// escapes and url() tokens, including those used by scientific figures.
export const websiteCSSByteLimit=16*1024*1024;
const decoding=[
 [/\/\*[\s\S]*?\*\//g,()=> ''],
 [/\\([a-f0-9]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff))],
 [/\\([^\r\n])/g,(_,literal)=>literal]
];
export function decodedWebsiteCSS(css){for(const [pattern,replace] of decoding)css=css.replace(pattern,replace);return css;}
// Only a failed authoring check needs to map a decoded value back to source.
// Map the two boundaries, so a long stylesheet never needs a per-character map.
export function websiteCSSSourceRange(css,start,end){
 const phases=[];
 for(const [pattern,replace] of decoding){phases.push([css,pattern,replace]);css=css.replace(pattern,replace);}
 function original(text,pattern,replace,at,right){
  let delta=0;
  for(const match of text.matchAll(pattern)){
   const pos=match.index-delta,length=replace(...match).length;
   if(at<pos||at===pos&&(length||right))break;
   if(at<pos+length)return match.index+(right?match[0].length:0);
   delta+=match[0].length-length;
  }
  return at+delta;
 }
 for(const [text,pattern,replace] of phases.reverse()){
  start=original(text,pattern,replace,start,false);end=original(text,pattern,replace,end,true);
 }
 return {start,end};
}
export function* websiteCSSURLTokens(decoded){
 for(const m of decoded.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))yield {value:(m[1]??m[2]??m[3]).trim(),start:m.index,end:m.index+m[0].length};
}
export function* websiteCSSURLs(decoded){for(const token of websiteCSSURLTokens(decoded))yield token.value;}
