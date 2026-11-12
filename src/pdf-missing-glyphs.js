import {parse} from 'parse5';
import {PDF_PREFLIGHT_LIMIT} from './pdf-preflight.js';

// Examine the already-authorized print copy only when embedding identifies
// missing characters. Normal compilation keeps no second index of all text.
export function positionedGlyphFailures(html,font,points){
 if(!html.includes('data-pdf-composition-key='))return null;
 const missing=new Set(points),findings=[],reported=new Set();let truncated=false;
 const stack=[{node:parse(html),sectionId:null,blockId:null,currentFont:null}];
 while(stack.length){
  let {node,sectionId,blockId,currentFont}=stack.pop();
  if(node.nodeName==='#text'){
   if(blockId&&currentFont===font&&!reported.has(sectionId+'/'+blockId)){
    for(const char of node.value)if(missing.has(char.codePointAt(0))){
     if(findings.length===PDF_PREFLIGHT_LIMIT){truncated=true;break;}
     reported.add(sectionId+'/'+blockId);
     const match=/^composition-block:(\d+)$/.exec(blockId);
     findings.push({code:'PDF_GLYPH',severity:'fatal',sectionId,blockId,blockIndex:match?Number(match[1]):null,details:{}});break;
    }
   }
   if(truncated)break;continue;
  }
  if(node.tagName==='head'||node.tagName==='style'||node.tagName==='script')continue;
  const attrs=Object.fromEntries((node.attrs??[]).map(({name,value})=>[name,value])),classes=(attrs.class??'').split(/\s+/);
  if(classes.includes('katex')||attrs.hidden!==undefined)continue;
  if(classes.includes('pdf-section')){
   if(!classes.includes('pdf-composed-section'))continue;
   sectionId=attrs.id?.replace(/^pdf-section-/,'');currentFont=attrs['data-pdf-font'];
  }
  if(sectionId&&attrs['data-pdf-composition-key'])blockId=attrs['data-pdf-block-id'];
  const face=classes.find(name=>name.startsWith('rt-font-'));if(face)currentFont=face.slice(8);
  const children=node.childNodes??[];for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],sectionId,blockId,currentFont});
 }
 return findings.length?{version:1,status:'fatal',findings,truncated}:null;
}
