import {randomUUID} from 'node:crypto';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {researchId} from './web/research-reference.js';
import {parsePdfCrossReference,PDF_CROSS_REFERENCE_PREFIX} from './web/pdf-cross-reference-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=(sectionId,kind,blockId)=>[sectionId,kind,blockId??''].join(':');
const reference=node=>node?.type==='text'?node.marks?.find(mark=>mark.type==='link'&&mark.attrs.href.startsWith(PDF_CROSS_REFERENCE_PREFIX)):null;
// Register only audience-included rendered sections. Authored labels are never
// trusted as numbering, even when a print layout deliberately disables links.
export function pdfCrossReferences(header,{textGlyphs=()=>{},maxBytes=16*1024*1024,signal}={}){
 if(!researchId(header?.id)||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new PdfLayoutError('PDF_LAYOUT');
 const targets=new Map(),uses=new Map();let serial=0,registeredBytes=0;
 const prefix='\uE000pdf-reference-'+randomUUID()+'-';
 function fail(sectionId,blockId=null){throw new PdfLayoutError('PDF_UNRESOLVED_REFERENCE',[sectionId,...(blockId?[blockId]:[])]);}
 function add(sectionId,kind,blockId,value){
  const id=key(sectionId,kind,blockId),existing=targets.get(id);registeredBytes+=Buffer.byteLength(JSON.stringify(value));if(registeredBytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
  if(existing)existing.ambiguous=true;else targets.set(id,value);
 }
 function section(value,heading,captionTargets=[]){
  signal?.throwIfAborted();const sectionId=value.id,layout=value.layout??header.layout;
  if(!researchId(sectionId)||!heading||typeof heading.number!=='string'||!/^\d+(?:\.\d+)*$/.test(heading.number))throw new PdfLayoutError('PDF_SECTION');
  add(sectionId,'section',null,{anchor:'pdf-section-'+sectionId,text:heading.title,numbered:!!header.structure?.numberSections&&!!value.title,links:layout.links!=='disabled'});
  for(const target of captionTargets){
   signal?.throwIfAborted();if(!researchId(target.blockId))continue;
   if(target.sectionId!==sectionId||!['figure','table'].includes(target.kind)||!Number.isSafeInteger(target.number)||target.number<1||typeof target.anchor!=='string'||!target.anchor)throw new PdfLayoutError('PDF_SECTION',[sectionId]);
   const figure=target.kind==='figure',caption=header.structure?.caption;
   add(sectionId,target.kind,target.blockId,{anchor:target.anchor,text:(figure?caption?.figureLabel:caption?.tableLabel)+' '+target.number,numbered:!!caption?.[figure?'numberFigures':'numberTables'],links:layout.links!=='disabled'});
  }
 }
 function project(value,{sectionId,layout=header.layout}={}){
  signal?.throwIfAborted();if(!researchId(sectionId))throw new PdfLayoutError('PDF_SECTION');
  function visit(node){
   signal?.throwIfAborted();const mark=reference(node);
   if(mark){
    const target=parsePdfCrossReference(mark.attrs.href);if(!target||target.documentId!==header.id)fail(sectionId,target?.blockId);
    const token=prefix+serial+++'\uE001',font=node.marks?.find(item=>item.type==='font_family')?.attrs.font??layout.font;
    uses.set(token,{target,sectionId,font,links:layout.links!=='disabled'});
    const result={...node,text:token,marks:node.marks.filter(item=>item.type!=='link')};if(!result.marks.length)delete result.marks;return result;
   }
   if(!node.content)return node;
   const content=[];let previous=null;
   for(const child of node.content){
    const link=reference(child);if(link&&previous===link.attrs.href)continue;
    content.push(visit(child));previous=link?.attrs.href??null;
   }
   return {...node,content};
  }
  return visit(value);
 }
 function finish(html){
  signal?.throwIfAborted();if(typeof html!=='string')throw new PdfLayoutError('PDF_INPUT');let bytes=Buffer.byteLength(html);if(bytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
  // Tokens are private to this compile. A composed block may repeat a token;
  // an omitted block has no token in the output and reveals no target metadata.
  const expression=new RegExp(prefix+'[0-9]+\uE001','g');
  return html.replace(expression,token=>{
   signal?.throwIfAborted();const use=uses.get(token);if(!use)throw new PdfLayoutError('PDF_INPUT');const target=targets.get(key(use.target.sectionId,use.target.kind,use.target.blockId));
   if(!target||target.ambiguous||!target.numbered)fail(use.sectionId,use.target.blockId);
   textGlyphs(use.font,target.text);const label=esc(target.text),linked=header.structure?.internalLinks!==false&&header.layout.links!=='disabled'&&use.links&&target.links;
   const result=linked?'<a class="pdf-cross-reference" href="#'+esc(target.anchor)+'">'+label+'</a>':label;bytes+=Buffer.byteLength(result)-Buffer.byteLength(token);if(bytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');return result;
  });
 }
 return {project,section,finish};
}
