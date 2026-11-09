import {validPdfNotes,pdfNoteCall,pdfNoteLocations} from './web/pdf-notes-model.js';
import {researchId} from './web/research-reference.js';
import {validFont,fontStack} from './web/font-catalogue.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {scopePdfIds} from './pdf-figure-renderer.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Section fragments are scoped together by the compiler. Endnotes live outside
// that scope, so their return links include the exact section prefix already.
export async function renderPdfNotes(section,{startNumber=1,renderContent,textGlyphs=()=>{},font='atkinson',fontSizePt=11,lineHeight=1.5,links=true,scopePrefix='pdf-section-'+section.id+'-',signal,sectionLabel='Section notes'}={}){
 signal?.throwIfAborted();const notes=section.notes??[];
 if(!researchId(section.id)||!validPdfNotes(notes)||!Number.isSafeInteger(startNumber)||startNumber<1||!Number.isSafeInteger(startNumber+notes.length)||!validFont(font)||!Number.isFinite(fontSizePt)||fontSizePt<6||fontSizePt>96||!Number.isFinite(lineHeight)||lineHeight<1||lineHeight>3||typeof links!=='boolean')throw new PdfLayoutError('PDF_LAYOUT');
 if(notes.length&&typeof renderContent!=='function')throw new PdfLayoutError('PDF_LAYOUT');
 const references=[],inlineReferences=new Map(),footnotes=[],pageFootnotes=[],endnotes=[];let number=startNumber;
 const locations=pdfNoteLocations(section.content??''),inlineIds=new Set(notes.filter(note=>note.anchor==='inline').map(note=>note.id));
 for(const [id,at] of locations)if(at.ambiguous||!inlineIds.has(id))throw new PdfLayoutError('PDF_NOTE_ANCHOR',[section.id,inlineIds.has(id)?id:null,researchId(id)?pdfNoteCall(id):null]);
 const sorted=notes.map((note,index)=>{
  const at=locations.get(note.id);if(note.anchor==='inline'&&!at)throw new PdfLayoutError('PDF_NOTE_ANCHOR',[section.id,note.id]);
  return {note,block:at?.block??note.block,ordinal:at?.ordinal??-1,index};
 }).sort((a,b)=>a.block-b.block||a.ordinal-b.ordinal||a.index-b.index);
 for(const {note,block} of sorted){
  signal?.throwIfAborted();const current=number++,suffix=section.id+'-'+note.id,destination=section.id.replaceAll('-','')+note.id.replaceAll('-',''),reference='pdf-note-ref-'+destination,target=(note.kind==='endnote'?'pdf-endnote-':'pdf-note-')+destination;
  const rendered=await renderContent(note.content,{sectionId:section.id,noteId:note.id,number:current,kind:note.kind});signal?.throwIfAborted();if(typeof rendered!=='string')throw new PdfLayoutError('PDF_LAYOUT');
  textGlyphs(font,String(current)+(links?' Note '+current+' Back to reference '+current:''));
  const call='<sup class="pdf-note-reference" id="'+reference+'"'+(note.kind==='page-footnote'?' data-pdf-footnote-call="'+suffix+'" data-pdf-footnote-block="'+block+'"':'')+'>'+(links?'<a role="doc-noteref" href="#'+target+'" aria-label="Note '+current+'">'+current+'</a>':current)+'</sup>';
  if(note.anchor==='inline')inlineReferences.set(pdfNoteCall(note.id),call);else references.push({block,html:call});
  const body=note.kind==='endnote'?scopePdfIds(rendered,scopePrefix+'note-'+note.id+'-'):scopePdfIds(rendered,'note-'+note.id+'-');
  const backlink=(note.kind==='endnote'?scopePrefix:'')+reference;
  const html='<li value="'+current+'" style="font-family:'+esc(fontStack(font))+';font-size:'+fontSizePt+'pt;line-height:'+lineHeight+'"><aside id="'+target+'" role="'+(note.kind==='endnote'?'doc-endnote':'doc-footnote')+'">'+body+(links?'<p><a role="doc-backlink" href="#'+backlink+'">Back to reference '+current+'</a></p>':'')+'</aside></li>';
  if(note.kind==='page-footnote')pageFootnotes.push('<template data-pdf-footnote-source="'+suffix+'">'+html+'</template>');else (note.kind==='endnote'?endnotes:footnotes).push(html);
 }
 if(footnotes.length)textGlyphs(font,sectionLabel);
 return {references,inlineReferences,pageFootnotes,sectionNotes:footnotes.length?'<section class="pdf-section-notes" aria-label="'+esc(sectionLabel)+'"><h2>'+esc(sectionLabel)+'</h2><ol>'+footnotes.join('')+'</ol></section>':'',endnotes,nextNumber:number};
}
export function renderPdfEndnotes(entries,{label='Endnotes',textGlyphs=()=>{},font='atkinson',layoutClass=''}={}){
 if(!entries.length)return '';textGlyphs(font,label);
 return '<section class="pdf-endnotes'+(layoutClass?' '+esc(layoutClass):'')+'" role="doc-endnotes" aria-label="'+esc(label)+'"><h2>'+esc(label)+'</h2><ol>'+entries.join('')+'</ol></section>';
}
