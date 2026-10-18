import {pdfAudience,pdfSectionPublicationState,pdfSectionContentSummary} from './pdf-audience-model.js';
export {changePdfAudience,changePdfPublication} from './pdf-audience-model.js';
// The owning editor supplies its translated labels and existing command handler.
export function pdfAudienceFields(header,{esc,text}){
 const audience=pdfAudience(header);
 return '<section data-pdf-audience-fields><label class="field">'+esc(text('audience'))+'<select data-pdf-audience>'+['private','public'].map(value=>'<option value="'+value+'"'+(audience===value?' selected':'')+'>'+esc(text('audience'+(value==='private'?'Private':'Public')))+'</option>').join('')+'</select></label><p>'+esc(text(audience==='public'?'audiencePublicHint':'audiencePrivateHint'))+'</p></section>';
}
export function pdfPublicationFields(header,section,{esc,text}){
 const state=pdfSectionPublicationState(header,section),counts=pdfSectionContentSummary(section),publicEdition=pdfAudience(header)==='public';
 const button=(command,label,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="'+command+'"'+(disabled?' disabled':'')+'>'+esc(text(label))+'</button>';
 const status=publicEdition?{omitted:'audienceOmitted',pending:'audiencePending',changed:'audienceChanged',reviewed:'audienceReviewed'}[state.review]:state.included?'audienceIncluded':'audienceOmitted';
 return '<fieldset data-pdf-publication data-section-id="'+esc(section.id)+'" data-audience="'+pdfAudience(header)+'"><legend>'+esc(text('audienceSection'))+'</legend><p data-pdf-publication-counts>'+esc(text('audienceContent',counts))+'</p><p data-pdf-publication-status role="status">'+esc(text(status))+'</p>'+(publicEdition?'<p>'+esc(text('audienceReviewHint'))+'</p>':'')+'<div class="pdf-toolbar">'+button('audience-include','audienceInclude',state.choice==='include'||!publicEdition&&state.included)+button('audience-omit','audienceOmit',state.choice==='omit')+(publicEdition?button('audience-review','audienceReview',state.review==='reviewed'):'')+'</div></fieldset>';
}
export function pdfAudienceSummaryFields(summary,{esc,text}){
 if(!summary?.complete)return '';
 return '<p data-pdf-audience-summary role="status">'+esc(text('audienceSummary',summary))+'</p>';
}

// Save acknowledgements and preview status must not replace a focused control.
export function updatePdfPublicationFields(host,header,section,{esc,text}){
 const fields=host.querySelector('[data-pdf-publication]'),audience=pdfAudience(header);
 if(!fields||fields.dataset.sectionId!==section.id||fields.dataset.audience!==audience){host.innerHTML=pdfPublicationFields(header,section,{esc,text});return;}
 const state=pdfSectionPublicationState(header,section),publicEdition=audience==='public';
 const status=publicEdition?{omitted:'audienceOmitted',pending:'audiencePending',changed:'audienceChanged',reviewed:'audienceReviewed'}[state.review]:state.included?'audienceIncluded':'audienceOmitted';
 for(const [selector,value] of [['[data-pdf-publication-counts]',text('audienceContent',pdfSectionContentSummary(section))],['[data-pdf-publication-status]',text(status)]]){const node=fields.querySelector(selector);if(node.textContent!==value)node.textContent=value;}
 for(const [command,disabled] of [['audience-include',state.choice==='include'||!publicEdition&&state.included],['audience-omit',state.choice==='omit'],['audience-review',state.review==='reviewed']]){const button=fields.querySelector('[data-command="'+command+'"]');if(button&&button.disabled!==disabled)button.disabled=disabled;}
}
