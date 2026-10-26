import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Retain only the suffix which can begin a withheld marker. Reusing the check
// across text files also preserves checks at their concatenation boundaries.
export function withheldTextCheck(markers){
 const suffixLength=Math.max(0,...markers.map(marker=>marker.length-1));let suffix='';
 return text=>{
  const window=suffix+text;
  for(const marker of markers)assert.ok(!window.includes(marker),'Downloaded publication contains withheld text');
  suffix=suffixLength?window.slice(-suffixLength):'';
 };
}

export async function downloadFingerprint(body,{checkText}={}){
 const hash=createHash('sha256'),decoder=checkText?new TextDecoder():null;let size=0;
 for await(const bytes of body){size+=bytes.byteLength;hash.update(bytes);if(decoder)checkText(decoder.decode(bytes,{stream:true}));}
 if(decoder)checkText(decoder.decode());
 return {size,sha256:hash.digest('hex')};
}
