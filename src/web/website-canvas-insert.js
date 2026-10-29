import {childrenOf} from './composition-tree.js';
import {formattedText} from './formatted-text.js';
import {renderRichText} from './rich-text-model.js';
import {staticSectionContent,sectionMarkup} from './website-section-markup.js';
import {updateCanvasOrder} from './website-canvas-order.js';
import {popupMarkup,copyTextMarkup} from './website-popup-markup.js';
import {updateCanvasElement} from './website-canvas-element.js';
import './i18n/catalogues/websiteAuthoring.js';
import {t} from './i18n/index.js';

export function insertCanvasSections(root,sections,inserted,{esc,region=''}={}){
 if(!root)return false;
 inserted=inserted.map(section=>sections.find(value=>value.id===section.id)).filter(Boolean);
 const ids=new Set(inserted.map(section=>section.id)),doc=root.ownerDocument;
 function markup(section){
  const body=section.format==='rich'?renderRichText(section.richText,{resolveLink:href=>/^(https?:|mailto:|tel:|#)/.test(href)?href:null}):formattedText(section.body??'',section.format);
  const children=childrenOf(sections,section.id).filter(child=>ids.has(child.id)).map(markup).join('');
  const content=section.kind==='popup'?popupMarkup(section,{esc,id:(region?region+'-':'')+'section-'+section.id,children,editing:true}):section.kind==='copy-text'?copyTextMarkup(section,esc,{editing:true}):staticSectionContent(section,{esc,body,editing:true,children});
  return sectionMarkup(section,{esc,region,content:content??'<p class="muted" role="status" data-local-preview>'+esc(t('websiteAuthoring','editorPreparingPreview'))+'</p>'});
 }
 let added=false;
 for(const section of inserted){
  if(ids.has(section.parentId)||root.querySelector('[data-section-id="'+section.id+'"]'))continue;
  const template=doc.createElement('template');template.innerHTML=markup(section);root.append(template.content);added=true;
 }
 if(added){updateCanvasOrder(root,sections);for(const section of inserted)updateCanvasElement(root,section);}return added;
}
