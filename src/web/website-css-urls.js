// Saved site stylesheets and the authoring review must resolve the same CSS
// escapes and url() tokens, including those used by scientific figures.
export const websiteCSSByteLimit=16*1024*1024;
export function decodedWebsiteCSS(css){
 return css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([a-f0-9]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff))).replace(/\\([^\r\n])/g,'$1');
}
export function* websiteCSSURLTokens(decoded){
 for(const m of decoded.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))yield {value:(m[1]??m[2]??m[3]).trim(),start:m.index,end:m.index+m[0].length};
}
export function* websiteCSSURLs(decoded){for(const token of websiteCSSURLTokens(decoded))yield token.value;}
