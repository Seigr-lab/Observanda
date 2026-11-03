// Saved site stylesheets and the authoring review must resolve the same CSS
// escapes and url() tokens, including those used by scientific figures.
export const websiteCSSByteLimit=16*1024*1024;
export function decodedWebsiteCSS(css){
 return css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([a-f0-9]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff))).replace(/\\([^\r\n])/g,'$1');
}
export function* websiteCSSURLs(decoded){
 for(const m of decoded.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))yield (m[1]??m[2]??m[3]).trim();
}
