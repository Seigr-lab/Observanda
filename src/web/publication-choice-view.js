import {publicationText} from './publication-review.js';
import {EDITION_DETAILS} from './publication-selection.js';

export function readPublicationChoice(box,item){
 const choice=structuredClone(item.choice),inputs=[...box.querySelectorAll('[data-edition-choice]')].filter(el=>el.closest('[data-edition-owner]')===box);
 const ids=key=>inputs.filter(el=>el.dataset.editionChoice===key&&el.checked).map(el=>el.value);
 choice.include=inputs.find(el=>el.dataset.editionChoice==='include').checked;
 choice.body=inputs.find(el=>el.dataset.editionChoice==='body').checked;
 for(const key of ['sections','fields','attachments'])choice[key]=ids(key);
 const details=ids('details');
 if(details.length===EDITION_DETAILS.length)delete choice.details;else choice.details=details;
 choice.figures=ids('figures').map(id=>({id,data:inputs.find(el=>el.dataset.editionChoice==='data'&&el.value===id).checked}));
 return choice;
}
export function publicationChoiceView(item,c,esc){
 const text=(key,values)=>esc(publicationText(key,values));
 const check=(key,id,label,checked,disabled=false)=>`<label class="checkbox"><input type="checkbox" data-edition-choice="${key}" value="${esc(id)}"${checked?' checked':''}${disabled?' disabled':''}><span>${label}</span></label>`;
 const group=key=>item[key].length?`<fieldset><legend>${text('selection'+key[0].toUpperCase()+key.slice(1))}</legend>${item[key].map((v,i)=>check(key,v.id,esc(v.title||publicationText('selectionAttachment',{number:i+1,kind:v.kind})),c[key].includes(v.id))).join('')}</fieldset>`:'';
 const details=`<fieldset><legend>${text('selectionDetails')}</legend>${EDITION_DETAILS.map(key=>check('details',key,text('selectionDetail'+key[0].toUpperCase()+key.slice(1)),(c.details??EDITION_DETAILS).includes(key))).join('')}</fieldset>`;
 return `${check('include',item.id,text('selectionInclude'),c.include)}<div data-edition-parts${c.include?'':' hidden'}>${check('body','',text('selectionBody'),c.body)}${details}${group('fields')}${group('sections')}${group('attachments')}${item.figures.length?`<fieldset><legend>${text('selectionFigures')}</legend>${item.figures.map(f=>{const choice=c.figures.find(v=>v.id===f.id);return `<div>${check('figures',f.id,esc(f.title),!!choice)}${check('data',f.id,text('selectionData',{title:f.title}),!!choice?.data,!choice)}</div>`;}).join('')}</fieldset>`:''}</div>`;
}
