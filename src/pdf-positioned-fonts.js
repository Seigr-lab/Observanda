// The native print worker owns this isolated document. Chromium reports the font
// actually used for each text run after web fonts and print layout settle.
function markText(){
 const owners=[],nodes=[];
 for(const box of document.querySelectorAll('[data-pdf-composition-key]')){
  const sectionId=box.closest('.pdf-section')?.id.slice('pdf-section-'.length);
  if(!sectionId)continue;
  const blockId=box.getAttribute('data-pdf-block-id'),key=box.dataset.pdfCompositionKey;
  const blockIndex=/^block:\d+$/.test(key)?Number(key.slice(6)):null;
  const walker=document.createTreeWalker(box,NodeFilter.SHOW_TEXT);
  let owner=null;
  while(walker.nextNode()){
   const text=walker.currentNode,element=text.parentElement;
   if(!element||!text.data.trim()||element.hasAttribute('data-pdf-font-probe')||element.closest('[hidden],.katex-mathml'))continue;
   if(!element.getClientRects().length||getComputedStyle(element).visibility!=='visible')continue;
   if(owner===null){owner=owners.length;owners.push({sectionId,blockId,blockIndex});}
   element.setAttribute('data-pdf-font-probe','');nodes.push(owner);
  }
 }
 return {owners,nodes};
}
const mark='('+markText.toString()+')()';
const unmark="document.querySelectorAll('[data-pdf-font-probe]').forEach(element=>element.removeAttribute('data-pdf-font-probe'))";

export async function inspectPositionedFonts(contents,report,{signal,limit}){
 const send=(method,params)=>contents.debugger.sendCommand(method,params);
 try{
  const {owners,nodes}=await contents.executeJavaScript(mark);
  if(!nodes.length)return report;
  await send('DOM.enable');await send('CSS.enable');
  const {root}=await send('DOM.getDocument',{depth:0});
  const {nodeIds}=await send('DOM.querySelectorAll',{nodeId:root.nodeId,selector:'[data-pdf-font-probe]'});
  if(nodeIds.length!==nodes.length)throw new Error('PDF_OUTPUT');
  const found=new Set(),findings=report.findings.slice();let truncated=report.truncated;
  for(let start=0;start<nodeIds.length;start+=32){
   signal.throwIfAborted();
   const group=nodeIds.slice(start,start+32);
   const fonts=await Promise.all(group.map((nodeId,i)=>found.has(nodes[start+i])?null:send('CSS.getPlatformFontsForNode',{nodeId})));
   for(let i=0;i<fonts.length;i++){
    const owner=nodes[start+i];
    if(found.has(owner)||!fonts[i]?.fonts.some(font=>!font.isCustomFont&&font.glyphCount>0))continue;
    found.add(owner);
    if(findings.length===limit){truncated=true;break;}
    findings.push({...owners[owner],code:'PDF_FONT_SUBSTITUTED',severity:'warning',details:{}});
   }
   if(truncated&&findings.length===limit)break;
  }
  return {...report,status:report.status==='ok'&&findings.length?'warning':report.status,findings,truncated};
 }finally{if(!contents.isDestroyed())await contents.executeJavaScript(unmark);}
}
