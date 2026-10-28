import {sectionStyle} from './website-model.js';
import {publicationText} from './publication-messages.js';

// Shared by static publication and immediate authoring feedback. Record/media
// resolution remains with the authenticated publication renderer.
export function staticSectionContent(section,{esc,body='',children='',editing=false}={}){
 if(section.kind==='container')return '<div class="container-content container-'+section.layout+' container-columns-'+section.columns+'">'+children+'</div>';
 if(section.kind==='disclosure')return '<details class="section-disclosure-content"'+(section.open||editing?' open':'')+'><summary>'+esc(section.title||publicationText('disclosure'))+'</summary><div class="container-content container-column">'+children+'</div></details>';
 if(section.kind==='heading')return '<h'+section.level+'>'+esc(section.title)+'</h'+section.level+'>';
 if(['text','callout'].includes(section.kind))return '<div class="prose">'+body+'</div>';
 if(section.kind==='divider')return '<hr>';
 return null;
}
export function sectionMarkup(section,{esc,content='',region=''}={}){
 const style=sectionStyle(section);
 return `<section id="${region?region+'-':''}section-${section.id}" class="home-section block-width-${style.width} block-surface-${style.surface} block-align-${style.align} block-space-${style.space} section-${section.kind} ${['markdown','rich'].includes(section.format)?'formatted':''} section-layout-${section.layout??'inherit'}" data-section-id="${section.id}" data-element-kind="${section.kind}"${section.style?.fontSize!==undefined?' data-custom-text-size="true"':''}>${section.title&&!['hero','heading','container','disclosure','popup'].includes(section.kind)?`<h2>${esc(section.title)}</h2>`:''}${content}</section>`;
}
export function sectionStyleDeclarations(section){
 const style=section.style??{},rules=[];
 for(const [key,property] of [['fontSize','--body-size'],['padding','padding'],['radius','border-radius'],['background','background'],['color','color'],['fit','--media-fit']])if(style[key]!==undefined)rules.push(property+':'+style[key]+(['fontSize','padding','radius'].includes(key)?'px':''));
 for(const [key,variable] of [['headingAlign','heading'],['bodyAlign','body'],['itemHeadingAlign','item-heading'],['detailsAlign','details'],['captionAlign','caption'],['buttonAlign','button']])rules.push('--section-'+variable+'-align:'+(style[key]??style.align??'start'));
 if(section.kind==='popup'){rules.push('--popup-width:'+section.dialogWidth+'px');if(style.background)rules.push('--popup-background:'+style.background);if(style.padding!==undefined)rules.push('--popup-padding:'+style.padding+'px');if(style.radius!==undefined)rules.push('--popup-radius:'+style.radius+'px');}
 if(section.kind==='container')rules.push('--container-gap:'+section.gap+'px');
 if(style.color)rules.push('--page-text:'+style.color,'--page-muted:'+style.color);
 return rules.join(';');
}
