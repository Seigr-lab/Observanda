import {parseFragment} from 'parse5';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {researchId} from './web/research-reference.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlNamespace='http://www.w3.org/1999/xhtml';
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const classes=node=>(attr(node,'class')??'').split(/\s+/);
function plainText(node){
 const parts=[],pending=[node];
 while(pending.length){const value=pending.pop();if(value.nodeName==='#text')parts.push(value.value);else if(!['script','style','template'].includes(value.tagName)){if(value.tagName==='br')parts.push(' ');for(let i=(value.childNodes?.length??0)-1;i>=0;i--)pending.push(value.childNodes[i]);}}
 return parts.join('').replace(/\s+/gu,' ').trim();
}
function blockIdentity(node){
 for(let current=node;current?.tagName;current=current.parentNode){const explicit=attr(current,'data-pdf-block-id');if(researchId(explicit))return explicit;const match=/(?:record-block-|record-table-)([0-9a-f-]{36})$/i.exec(attr(current,'id')??'');if(match&&researchId(match[1]))return match[1];}
 return null;
}
// Only completed, scoped section HTML is parsed. Source-offset insertions keep
// authored caption markup, SVG references and asset URLs byte-for-byte intact.
export function pdfCaptionRenderer(header,{maxBytes=16*1024*1024,textGlyphs=()=>{},pageReference=()=>'',signal}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new PdfLayoutError('PDF_LAYOUT');
 const settings=header.structure?.caption,active=!!settings&&['numberFigures','numberTables','listFigures','listTables'].some(key=>settings[key]),counts={figures:0,tables:0},entries={figures:[],tables:[]};let listBytes=0;
 function section(html,{sectionId,font=header.layout.font,links=header.layout.links,layout=header.layout}={}){
  signal?.throwIfAborted();if(typeof html!=='string'||!researchId(sectionId))throw new PdfLayoutError('PDF_SECTION');
  const htmlBytes=Buffer.byteLength(html);if(htmlBytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
  if(!active)return {html,targets:[]};
  const tree=parseFragment(html,{sourceCodeLocationInfo:true}),ids=new Map(),pending=[tree],nodes=[];
  while(pending.length){signal?.throwIfAborted();const node=pending.pop(),id=attr(node,'id');if(id)ids.set(id,(ids.get(id)??0)+1);nodes.push(node);for(let i=(node.childNodes?.length??0)-1;i>=0;i--)pending.push(node.childNodes[i]);}
  const insertions=[],targets=[],used=new Set(),ordinals={figure:0,table:0};let addedBytes=0;
  function insert(offset,value){if(!Number.isInteger(offset))throw new PdfLayoutError('PDF_SECTION',[sectionId]);addedBytes+=Buffer.byteLength(value);if(htmlBytes+addedBytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');insertions.push({offset,value,order:insertions.length});}
  for(const node of nodes){
   signal?.throwIfAborted();if(node.namespaceURI!==htmlNamespace||!['figure','table'].includes(node.tagName))continue;
   let excluded=false;for(let current=node;current?.tagName;current=current.parentNode)if(classes(current).some(value=>['book-equation','pdf-figure-data','book-table-linear'].includes(value))){excluded=true;break;}if(excluded)continue;
   const kind=node.tagName==='figure'?'figure':'table',plural=kind==='figure'?'figures':'tables',numbered=settings[kind==='figure'?'numberFigures':'numberTables'],listed=settings[kind==='figure'?'listFigures':'listTables'];
   if(!numbered&&!listed)continue;
   const location=node.sourceCodeLocation;if(!location?.startTag)throw new PdfLayoutError('PDF_SECTION',[sectionId]);
   const number=++counts[plural],position=++ordinals[kind],blockId=blockIdentity(node),captionTag=kind==='figure'?'figcaption':'caption',caption=node.childNodes?.find(child=>child.tagName===captionTag),prose=caption?plainText(caption):'',label=settings[kind==='figure'?'figureLabel':'tableLabel'],prefix=label+' '+number+'.',text=numbered?prefix+(prose?' '+prose:''):prose||label;
   let anchor=attr(node,'id');
   if(!anchor&&kind==='table')for(let current=node.parentNode;current?.tagName;current=current.parentNode)if(classes(current).includes('book-table')){anchor=attr(current,'id');break;}
   if(!anchor||ids.get(anchor)!==1||used.has(anchor)){
    const base='pdf-caption-'+sectionId+'-'+kind+'-'+(blockId??position);anchor=base;let suffix=1;while(ids.has(anchor)||used.has(anchor))anchor=base+'-'+(++suffix);
    if(!attr(node,'id'))insert(location.startTag.endOffset-1,' id="'+esc(anchor)+'"');else insert(location.startOffset,'<span class="pdf-caption-anchor" id="'+esc(anchor)+'"></span>');
    ids.set(anchor,1);
   }
   used.add(anchor);
   if(numbered){
    const added='<span class="pdf-caption-label">'+esc(prefix)+'</span>';
    if(caption?.sourceCodeLocation?.startTag)insert(caption.sourceCodeLocation.startTag.endOffset,added+(prose?' ':''));
    else insert(kind==='table'?location.startTag.endOffset:location.endTag?.startOffset,'<'+captionTag+'>'+added+'</'+captionTag+'>');
    textGlyphs(font,prefix);
   }
   targets.push({kind,sectionId,blockId,anchor,number,text});
   if(listed){const linked=header.structure?.internalLinks!==false&&header.layout.links!=='disabled'&&links!=='disabled',entry='<li>'+(linked?'<a href="#'+esc(anchor)+'">'+esc(text)+'</a>':esc(text))+pageReference(anchor,layout)+'</li>';listBytes+=Buffer.byteLength(entry);if(listBytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');entries[plural].push({html:entry,text});}
  }
  insertions.sort((a,b)=>a.offset-b.offset||a.order-b.order);const result=[];let offset=0;for(const change of insertions){result.push(html.slice(offset,change.offset),change.value);offset=change.offset;}result.push(html.slice(offset));return {html:result.join(''),targets};
 }
 function lists(){
  signal?.throwIfAborted();if(!active)return '';
  const result=[];for(const kind of ['figures','tables']){if(!settings[kind==='figures'?'listFigures':'listTables'])continue;const title=settings[kind==='figures'?'figuresTitle':'tablesTitle'];result.push('<nav class="pdf-caption-list pdf-'+kind+'-list" aria-label="'+esc(title)+'"><h1>'+esc(title)+'</h1><ol style="list-style:none;padding:0">'+entries[kind].map(entry=>entry.html).join('')+'</ol></nav>');textGlyphs(header.layout.font,title);for(const entry of entries[kind])textGlyphs(header.layout.font,entry.text);}
  const html=result.join('');if(Buffer.byteLength(html)>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');return html;
 }
 return {section,lists,counts:()=>({...counts})};
}
