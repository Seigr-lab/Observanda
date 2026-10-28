import {sectionStyle} from './website-model.js';
import {sectionStyleDeclarations} from './website-section-markup.js';
import {formattedText} from './formatted-text.js';
import {publicationText} from './publication-messages.js';

export function updateCanvasElement(root,section,{key=null}={}){
 const block=root?.querySelector('[data-section-id="'+section.id+'"]');if(!block)return false;
 const doc=block.ownerDocument,style=sectionStyle(section);
 for(const [prefix,value] of [['block-width-',style.width],['block-surface-',style.surface],['block-align-',style.align],['block-space-',style.space],['section-layout-',section.layout??'inherit']]){
  for(const name of [...block.classList])if(name.startsWith(prefix)&&name!==prefix+value)block.classList.remove(name);
  block.classList.add(prefix+value);
 }
 block.classList.toggle('formatted',['markdown','rich'].includes(section.format));block.classList.toggle('canvas-hidden-element',section.show===false);
 block.toggleAttribute('data-custom-text-size',section.style?.fontSize!==undefined);
 // Replace the precise original rule so resetting a style really restores
 // inheritance. A new authoritative stylesheet naturally replaces this edit.
 const sheet=doc.querySelector('link[href$="styles.css"]')?.sheet,selector='[data-page="'+doc.body.dataset.page+'"] [data-section-id="'+section.id+'"]';
 if(sheet){for(let i=sheet.cssRules.length-1;i>=0;i--)if(sheet.cssRules[i].selectorText===selector)sheet.deleteRule(i);sheet.insertRule(selector+'{'+sectionStyleDeclarations(section)+'}',sheet.cssRules.length);}
 if(section.kind==='heading'&&['title','level'].includes(key)&&Number.isInteger(section.level)&&section.level>=1&&section.level<=6){
  let heading=block.querySelector(':scope > :is(h1,h2,h3,h4,h5,h6)');
  if(heading?.tagName!=='H'+section.level){const replacement=doc.createElement('h'+section.level);if(heading)heading.replaceWith(replacement);else block.append(replacement);heading=replacement;}
  heading.textContent=section.title;
 }else if(key==='title'&&!['hero','container','disclosure','popup'].includes(section.kind)){
  let heading=block.querySelector(':scope>h2');if(!section.title)heading?.remove();else{if(!heading){heading=doc.createElement('h2');block.prepend(heading);}heading.textContent=section.title;}
 }
 if(['text','callout'].includes(section.kind)&&['body','format'].includes(key)&&section.format!=='rich'){
  const prose=block.querySelector(':scope>.prose');if(prose&&!prose.querySelector('.ProseMirror'))prose.innerHTML=formattedText(section.body??'',section.format);
 }
 if(section.kind==='container'){
  const content=block.querySelector(':scope>.container-content');if(content)content.className='container-content container-'+section.layout+' container-columns-'+section.columns;
 }
 if(section.kind==='disclosure'&&key==='title'){const summary=block.querySelector(':scope>details>summary');if(summary)summary.textContent=section.title||publicationText('disclosure');}
 if(section.kind==='popup'&&['title','label'].includes(key)){
  const title=section.title||section.label||publicationText('popupOpen'),summary=block.querySelector(':scope>details>summary'),heading=block.querySelector(':scope>details>.popup-body>h2');
  if(summary)summary.textContent=section.label||title;if(heading)heading.textContent=title;
 }
 if(section.kind==='copy-text'){
  const copy=block.querySelector(':scope>.public-copy'),field=copy?.querySelector('textarea'),button=copy?.querySelector('button');
  if(copy&&key==='value'){copy.dataset.copyValue=JSON.stringify(section.value);if(field)field.value=section.value;}
  if(field&&key==='title')field.setAttribute('aria-label',section.title||publicationText('copyValue'));
  if(button&&key==='label')button.textContent=section.label||publicationText('copyAction');
  if(copy&&key==='body'){let body=copy.querySelector(':scope>.prose');if(!section.body)body?.remove();else{if(!body){body=doc.createElement('p');body.className='prose';copy.prepend(body);}body.textContent=section.body;}}
 }
 return true;
}
