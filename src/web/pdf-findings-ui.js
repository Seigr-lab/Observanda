import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {proseDocument} from './prose-model.js';
export function pdfFindingsFields(value,{esc,button}){
 if(!value)return '';const text=key=>t('pdfEditor',key);
 return '<section class="panel" data-pdf-preflight><h2>'+esc(text('preflight'))+'</h2><p>'+esc(text(value.status==='ok'?'preflightClear':'preflightReview'))+'</p>'+value.findings.map((finding,index)=>'<div class="pdf-toolbar"><span>'+esc(t('errors',finding.code))+'</span>'+(finding.sectionId?button('showFinding','finding','data-finding="'+index+'"'):'')+'</div>').join('')+(value.truncated?'<p>'+esc(text('preflightTruncated'))+'</p>':'')+'<p>'+esc(text('preflightScope'))+'</p></section>';
}
// Targets are resolved against the selected saved section, never executable
// selectors received from a renderer. Highlighting changes only editor DOM.
export function focusPdfFinding(host,section,finding,focusLink){
 if(!host||!section||finding?.sectionId!==section.id)return false;
 for(const node of host.querySelectorAll('[data-pdf-finding-target]'))node.removeAttribute('data-pdf-finding-target');
 const blockId=finding.blockId??'',by=(selector,value,attribute)=>[...host.querySelectorAll(selector)].find(node=>node.getAttribute(attribute)===value),field=key=>by('[data-document-key]',key,'data-document-key'),editable=node=>node?.querySelector('[contenteditable="true"]');let target;
 if(finding.code==='PDF_PLACEMENT_REVIEW')target=host.querySelector('[data-pdf-placement-review] [data-command="placement-adjust"]');
 if(blockId.startsWith('composition-'))target=by('[data-pdf-composition-handle]',blockId.slice(12),'data-pdf-composition-handle');
 const note=(section.notes??[]).find(note=>blockId.includes(note.id));
 const link=(finding.code==='PDF_UNRESOLVED_REFERENCE'||finding.code==='PDF_NOTE_ANCHOR')&&finding.details?.target;
 const key=note&&finding.code!=='PDF_NOTE_ANCHOR'?'pdf-note-'+note.id:section.id;
 if(link){const anchor=[...(field(key)?.querySelectorAll('a[href]')??[])].find(node=>node.getAttribute('href')===link);if(anchor)target=anchor;}
 if(!target&&note&&finding.code==='PDF_NOTE_ANCHOR')target=by('[data-pdf-note]',note.id,'data-pdf-note')?.querySelector('[data-command="note-move"]');
 if(!target&&note)target=editable(field('pdf-note-'+note.id));
 const image=(section.images??[]).find(image=>blockId.includes(image.id));if(!target&&image)target=by('[data-pdf-image]',image.id,'data-pdf-image')?.querySelector('input');
 const editor=editable(field(section.id));if(!target&&editor){const blocks=proseDocument(section.content).content??[],named=blocks.findIndex(block=>block.attrs?.id&&blockId.includes(block.attrs.id)),index=named>=0?named:finding.blockIndex;target=Number.isSafeInteger(index)&&index>=0?editor.children[index]:null;}
 target??=host.querySelector('[data-pdf-section="title"]');if(!target)return false;
 for(let parent=target.parentElement;parent&&parent!==host;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 target.setAttribute('data-pdf-finding-target','');const focus=target.matches('button,input,select,textarea,[contenteditable="true"]')?target:target.querySelector('[data-book-edit]')??target.closest('[contenteditable="true"]');
 if(!link||!focusLink?.(key,link))focus?.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});return true;
}
