import {pdfStructureDefaults} from './web/pdf-structure-model.js';
import {parseResearchReference} from './web/research-reference.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=target=>[target.workspaceId,target.id,target.revision??'',target.selector?.kind??'',target.selector?.id??''].join(':');
export function pdfDocumentOutline(header){
 const settings=header.structure??pdfStructureDefaults(),entries=[],counts=[0,0,0,0,0,0],destinations=new Map(),links=[];
 function destination(target,anchor){const id=key(target);if(!destinations.has(id))destinations.set(id,new Set());destinations.get(id).add(anchor);}
 function section(section){
  const level=section.level??1;counts[level-1]++;for(let i=level;i<counts.length;i++)counts[i]=0;
  const number=counts.slice(0,level).map(value=>value||1).join('.'),title=(settings.numberSections&&section.title?number+' ':'')+section.title;
  if(section.title)entries.push({id:section.id,level,title});
  const source=section.research;
  if(source){const base={workspaceId:source.workspaceId,id:source.recordId},anchor='pdf-section-'+section.id,selector=source.collection==='body'?null:{kind:source.collection==='figures'?'figure':'section',id:source.itemId};
   for(const revision of [undefined,source.recordRevision])destination({...base,revision,...(selector?{selector}:{})},anchor);
  }
  return {level,title};
 }
 function link(href,sectionId,layout){
  if(layout.links==='disabled')return null;
  const target=parseResearchReference(href);
  if(target){if(!settings.internalLinks)return null;if(target.kind!=='record')throw new PdfLayoutError('PDF_UNRESOLVED_REFERENCE',[sectionId]);const token='pdf-destination-'+links.length;links.push({target,token,sectionId});return '#'+token;}
  if(!settings.externalLinks)return null;
  if(!/^(?:https?:|mailto:|tel:)/.test(href))throw new PdfLayoutError('PDF_UNRESOLVED_REFERENCE',[sectionId]);return href;
 }
 function finish(html){
  for(const {target,token,sectionId} of links){const choices=destinations.get(key(target));if(choices?.size!==1)throw new PdfLayoutError('PDF_UNRESOLVED_REFERENCE',[sectionId]);html=html.replaceAll('href="#'+token+'"','href="#'+[...choices][0]+'"');}
  return html;
 }
 function contents(){
  if(!settings.contents)return '';
  return '<nav class="pdf-contents" aria-label="'+esc(settings.contentsTitle)+'"><h1>'+esc(settings.contentsTitle)+'</h1><ol>'+entries.map(entry=>'<li style="margin-inline-start:'+((entry.level-1)*5)+'mm">'+(settings.internalLinks&&header.layout.links!=='disabled'?'<a href="#pdf-section-'+entry.id+'">'+esc(entry.title)+'</a>':esc(entry.title))+'</li>').join('')+'</ol></nav>';
 }
 return {settings,section,link,finish,contents,text:()=>[settings.contentsTitle,...entries.map(entry=>entry.title)].join(' ')};
}
