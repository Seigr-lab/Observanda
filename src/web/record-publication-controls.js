import {PUBLICATION_PARTS,defaultPublicationPrivacy,figurePublicationChoices,withFigurePublicationChoices} from './record-publication-privacy.js';
import {sourceNotebookAllowed} from './source-publication-permissions.js';
import {t} from './i18n/index.js';

const text=(key,args)=>t('recordValues',key,args);
const targets=['website','pdf'];
const entryField=target=>target==='website'?'share':'sharePdf';
const targetLabel=target=>text('publication_'+target);

export function figureSharingFields(choices,title,esc,id=''){
 return '<fieldset><legend>'+esc(text('figureSharingNamed',{title}))+'</legend>'+targets.map(target=>'<label class="checkbox"><input type="checkbox" data-figure-sharing="'+target+'"'+(id?' data-publication-figure="'+esc(id)+'"':'')+(choices[target]?' checked':'')+'>'+esc(targetLabel(target))+'</label>').join('')+'<p class="muted">'+esc(text('figureSharingHelp'))+'</p></fieldset>';
}
export function publicationPartsFields(value,esc,figures=[]){
 const rows=PUBLICATION_PARTS.map(key=>'<tr><th scope="row">'+esc(text('publication_'+key))+'</th>'+targets.map(target=>
  '<td><label class="publication-part-choice"><input type="checkbox" aria-label="'+esc(targetLabel(target)+' · '+text('publication_'+key))+'" data-publication-target="'+target+'" data-publication-part="'+key+'"'+(value?.[target]?.[key]!==false?' checked':'')+'></label></td>'
 ).join('')+'</tr>').join('');
 return '<table class="publication-parts"><caption>'+esc(text('publicationParts'))+'</caption><thead><tr><td></td>'+targets.map(target=>'<th scope="col">'+esc(targetLabel(target))+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table><p class="muted">'+esc(text('publicationSections'))+'</p>'+figures.map(figure=>figureSharingFields(figurePublicationChoices(value,figure.id),typeof figure.title==='string'?figure.title:figure.title.preview,esc,figure.id)).join('');
}

export function updatePublicationPart(value,input){
 const {publicationFigure,figureSharing}=input.dataset;
 if(publicationFigure&&targets.includes(figureSharing))return withFigurePublicationChoices(value,publicationFigure,{...figurePublicationChoices(value,publicationFigure),[figureSharing]:input.checked});
 const {publicationTarget:target,publicationPart:part}=input.dataset;
 if(!targets.includes(target)||!PUBLICATION_PARTS.includes(part))return value;
 value??=defaultPublicationPrivacy();value[target][part]=input.checked;return value;
}

export function publicationChoices(website,pdf,esc){
 return '<span class="badge" data-publication-choices>'+targets.map(target=>esc(targetLabel(target)+' · '+text((target==='website'?website:pdf)?'yes':'no'))).join(' / ')+'</span>';
}

export function publicationAvailability(record,book,esc,{editing=false,draft=false,busy=false}={}){
 const edit=field=>'<button class="button subtle" type="button" data-action="record-value-edit" data-value-field="'+field+'"'+(busy?' disabled':'')+'>'+esc(t('experience','editField',{name:text(field)}))+'</button>';
 const choices=targets.map(target=>{
  const field=entryField(target),allowed=record[field]===true,bookOff=book&&!sourceNotebookAllowed(book,target);
  const status=text(!allowed?'private':bookOff?'publicationBookBlocked':'public');
  return draft?'<label class="checkbox"><input type="checkbox" data-entry="'+field+'"'+(allowed?' checked':'')+'>'+esc(text(field))+'</label>'+(bookOff?'<p class="muted">'+esc(targetLabel(target)+' · '+text('publicationBookBlocked'))+'</p>':''):
   '<div><dt>'+esc(targetLabel(target))+'</dt><dd>'+esc(status)+(editing?' '+edit(field):'')+'</dd></div>';
 }).join('');
 const parts=draft?'<details><summary>'+esc(text('publicationParts'))+'</summary>'+publicationPartsFields(record.publication,esc,record.figures)+'</details>':editing?edit('publication'):'';
 return '<section class="panel" data-record-publication><h3>'+esc(text('publicationOutputs'))+'</h3>'+(draft?choices:'<dl class="record-edit-details">'+choices+'</dl>')+parts+'<p class="muted">'+esc(text('publicationHelp'))+'</p></section>';
}
