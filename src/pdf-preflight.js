// Measurements describe the compiled document at its printable width. They
// do not claim to reproduce Chromium's page-break decisions or font coverage.
export const PDF_PREFLIGHT_LIMIT=256;
const codes=new Set(['PDF_COMPOSITION_OVERLAP','PDF_COMPOSITION_OVERFLOW','PDF_PAGE_GEOMETRY','PDF_SECTION_HIDDEN','PDF_FONT_FAILED','PDF_IMAGE_MISSING','PDF_IMAGE_RESOLUTION','PDF_CONTENT_OVERFLOW','PDF_CONTENT_CLIPPED','PDF_BLOCK_TOO_TALL','PDF_ANCHOR_MISSING','PDF_ANCHOR_AMBIGUOUS']);
const metricKeys=new Set(['widthPx','heightPx','availableWidthPx','availableHeightPx','dpi','recommendedDpi','naturalWidth','naturalHeight','count','target']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validPdfPreflight(value){
 if(!object(value)||Object.keys(value).sort().join()!=='findings,status,truncated,version'||value.version!==1||!['ok','warning','fatal'].includes(value.status)||typeof value.truncated!=='boolean'||!Array.isArray(value.findings)||value.findings.length>PDF_PREFLIGHT_LIMIT)return false;
 if(!value.findings.every(row=>object(row)&&Object.keys(row).sort().join()==='blockId,blockIndex,code,details,sectionId,severity'&&codes.has(row.code)&&['warning','fatal'].includes(row.severity)&&(row.sectionId===null||typeof row.sectionId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.sectionId))&&(row.blockId===null||typeof row.blockId==='string'&&row.blockId.length<=512)&&(row.blockIndex===null||Number.isSafeInteger(row.blockIndex)&&row.blockIndex>=0)&&object(row.details)&&Object.entries(row.details).every(([key,item])=>metricKeys.has(key)&&(key==='target'?typeof item==='string'&&item.length<=512:Number.isFinite(item)&&item>=0))))return false;
 return value.status===(value.findings.some(row=>row.severity==='fatal')?'fatal':value.findings.length||value.truncated?'warning':'ok');
}
// This function is serialized into the isolated, script-disabled document by
// the trusted desktop process. Keep it self-contained and free of DOM writes
// after its finally block restores the exact original section styles.
export async function measurePdfPreflight(){
 const findings=[],limit=256;let truncated=false;
 const sections=[...document.querySelectorAll('.pdf-section')],saved=sections.map(section=>[section,section.getAttribute('style')]),indices=new WeakMap();
 const mm=96/25.4,round=value=>Math.round(Math.max(0,value)*100)/100;
 const rendered=node=>{for(let current=node;current instanceof Element;current=current.parentElement){const style=getComputedStyle(current);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||current.getAttribute('aria-hidden')==='true')return false;}return true;};
 const identity=node=>{
  const section=node?.closest?.('.pdf-section'),raw=section?.getAttribute('data-pdf-section-id')??section?.id.replace(/^pdf-section-/,'');
  const sectionId=typeof raw==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw)?raw:null;
  let block=node?.closest?.('[data-pdf-block-id]');if(block===section)block=null;
  if(!block){let current=node;while(current&&current!==section){if(current.id){block=current;break;}current=current.parentElement;}}
  let top=node;while(top?.parentElement&&top.parentElement!==section&&top.parentElement!==document.body)top=top.parentElement;
  const blockId=(block?.getAttribute('data-pdf-block-id')??block?.id??null);
  return {sectionId,blockId:blockId?.slice(0,512)??null,blockIndex:section&&top?indices.get(top)??null:null};
 };
 const add=(code,severity,node,details={})=>{
  const row={code,severity,...identity(node),details};
  if(findings.length<limit)findings.push(row);else{truncated=true;if(severity==='fatal'&&!findings.some(item=>item.severity==='fatal'))findings[limit-1]=row;}
 };
 const number=value=>{const match=/^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|px)$/.exec(value.trim());if(!match)return NaN;return Number(match[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,px:25.4/96}[match[2]]);};
 const pageRules=[];for(const sheet of document.styleSheets){try{for(const rule of sheet.cssRules)if(rule.type===CSSRule.PAGE_RULE)pageRules.push(rule);}catch{}}
 const geometry=section=>{
  const width=section.getAttribute('data-pdf-width-mm'),height=section.getAttribute('data-pdf-height-mm');
  if(width!==null||height!==null)return {width:Number(width),height:Number(height)};
  const page=getComputedStyle(section).page,rule=pageRules.find(value=>value.selectorText===page)??pageRules.find(value=>!value.selectorText),style=rule?.style,parts=style?.getPropertyValue('size').trim().split(/\s+/);
  if(!parts||parts.length!==2)return null;
  return {width:number(parts[0])-number(style.getPropertyValue('margin-left')||'0mm')-number(style.getPropertyValue('margin-right')||'0mm'),height:number(parts[1])-number(style.getPropertyValue('margin-top')||'0mm')-number(style.getPropertyValue('margin-bottom')||'0mm')};
 };
 try{
  await document.fonts.ready;
  await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
  const failedFonts=[...document.fonts].filter(font=>font.status==='error').length;if(failedFonts)add('PDF_FONT_FAILED','fatal',null,{count:failedFonts});
  const boxes=new Map();
  for(const section of sections){
   [...section.children].forEach((child,index)=>indices.set(child,index));
   if(!rendered(section)){add('PDF_SECTION_HIDDEN','fatal',section);continue;}
   const box=geometry(section);if(!box)continue;
   if(!Number.isFinite(box.width)||!Number.isFinite(box.height)||box.width<=0||box.height<=0){add('PDF_PAGE_GEOMETRY','fatal',section);continue;}
   section.style.setProperty('width',box.width+'mm','important');section.style.setProperty('min-width','0','important');section.style.setProperty('max-width','none','important');
   boxes.set(section,box);
  }
  // Force layout after all section widths are set, including mixed page sizes.
  void document.body.offsetHeight;
  for(const image of document.images){
   if(!rendered(image))continue;
   if(!image.complete||image.naturalWidth===0||image.naturalHeight===0){add('PDF_IMAGE_MISSING','fatal',image);continue;}
   if(/^data:image\/svg\+xml(?:;|,)/i.test(image.currentSrc||image.src))continue;
   const rect=image.getBoundingClientRect();if(rect.width<=0||rect.height<=0)continue;
   const dpi=Math.min(image.naturalWidth/rect.width,image.naturalHeight/rect.height)*96;
   if(dpi<144)add('PDF_IMAGE_RESOLUTION','warning',image,{dpi:round(dpi),recommendedDpi:144,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,widthPx:round(rect.width),heightPx:round(rect.height)});
  }
  for(const item of document.querySelectorAll('[data-pdf-composition-key]')){
   if(item.getAttribute('data-pdf-composition-overlap')==='true')add('PDF_COMPOSITION_OVERLAP','warning',item,{count:2});
   if(item.scrollWidth>item.clientWidth+1||item.scrollHeight>item.clientHeight+1)add('PDF_COMPOSITION_OVERFLOW','warning',item,{widthPx:round(item.scrollWidth),heightPx:round(item.scrollHeight),availableWidthPx:round(item.clientWidth),availableHeightPx:round(item.clientHeight)});
  }
  const anchors=new Map();for(const element of document.querySelectorAll('[id],a[name]')){if(!rendered(element))continue;const key=element.id||element.getAttribute('name');if(key)anchors.set(key,(anchors.get(key)??0)+1);}
  for(const link of document.querySelectorAll('a[href]')){
   if(!rendered(link))continue;const href=link.getAttribute('href');if(!href.startsWith('#')||href==='#')continue;
   let target;try{target=decodeURIComponent(href.slice(1));}catch{target=href.slice(1);}
   const count=anchors.get(target)??0;if(count!==1)add(count?'PDF_ANCHOR_AMBIGUOUS':'PDF_ANCHOR_MISSING','warning',link,{target:target.slice(0,512),count});
  }
  for(const [section,box] of boxes){
   const sectionStyle=getComputedStyle(section),columns=Math.max(1,Number.parseInt(sectionStyle.columnCount)||1),gap=Number.parseFloat(sectionStyle.columnGap)||0,columnWidth=(box.width*mm-gap*(columns-1))/columns;
   if(columnWidth<=0){add('PDF_PAGE_GEOMETRY','fatal',section);continue;}
   for(const element of section.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,table,th,td,tr,figure,img,svg,[data-pdf-block-id]')){
    if(!rendered(element)||element.closest('.katex-mathml'))continue;
    const fragments=[...element.getClientRects()],rect={width:Math.max(0,...fragments.map(item=>item.width)),height:Math.max(0,...fragments.map(item=>item.height))},style=getComputedStyle(element);if(!rect.width||!rect.height)continue;
    const availableWidth=style.columnSpan==='all'?box.width*mm:columnWidth,wide=rect.width>availableWidth+1||element.clientWidth>0&&element.scrollWidth>element.clientWidth+1;
    const clippedX=['hidden','clip'].includes(style.overflowX)&&element.scrollWidth>element.clientWidth+1,clippedY=['hidden','clip'].includes(style.overflowY)&&element.scrollHeight>element.clientHeight+1;
    if(clippedX||clippedY)add('PDF_CONTENT_CLIPPED','warning',element,{widthPx:round(element.scrollWidth),heightPx:round(element.scrollHeight),availableWidthPx:round(element.clientWidth),availableHeightPx:round(element.clientHeight)});
    else if(wide)add('PDF_CONTENT_OVERFLOW','warning',element,{widthPx:round(Math.max(rect.width,element.scrollWidth)),availableWidthPx:round(availableWidth)});
    if((['IMG','svg','TR','FIGURE'].includes(element.tagName)||['avoid','avoid-page','avoid-column'].includes(style.breakInside))&&rect.height>box.height*mm+1)add('PDF_BLOCK_TOO_TALL','warning',element,{heightPx:round(rect.height),availableHeightPx:round(box.height*mm)});
   }
  }
  return {version:1,status:findings.some(row=>row.severity==='fatal')?'fatal':findings.length||truncated?'warning':'ok',findings,truncated};
 }finally{for(const [section,style] of saved){if(style===null)section.removeAttribute('style');else section.setAttribute('style',style);}}
}
export const pdfPreflightScript='('+measurePdfPreflight.toString()+')()';
