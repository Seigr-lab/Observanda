import {treeOrder} from './composition-tree.js';
import {proseText} from './prose-model.js';

// The credit follows the closing authored text, including paragraph-level
// alignment. Only a footer with no authored content uses the centered fallback.
export function footerTextAlignment(footer,plainText=''){
  if(!footer)return plainText.trim()?'start':'center';
  const visible=treeOrder(footer.sections).map(row=>row.element).filter(s=>{
    if(!s.show)return false;
    let parent=s.parentId;
    while(parent){const ancestor=footer.sections.find(a=>a.id===parent);if(!ancestor?.show||ancestor.kind==='popup')return false;parent=ancestor.parentId;}
    return true;
  });
  for(const section of visible.toReversed()){
    if(section.kind==='popup')continue;
    if(['text','callout','hero','link'].includes(section.kind)&&proseText(section.richText??section.body??'').trim()){
      let align=section.style?.bodyAlign??section.style?.align??'start';
      if(section.format==='rich'){
        const paragraphs=[];
        const visit=node=>{if(['paragraph','heading'].includes(node.type)&&proseText({type:'doc',content:[node]}).trim())paragraphs.push(node);else node.content?.forEach(visit);};
        visit(section.richText);
        const explicit=paragraphs.at(-1)?.attrs?.align;
        if(explicit&&explicit!=='inherit')align=explicit;
      }
      return align;
    }
    if(section.title.trim()&&!['container','contents','divider'].includes(section.kind))return section.style?.headingAlign??section.style?.align??'start';
    if(section.kind==='link'&&section.label.trim())return section.style?.buttonAlign??section.style?.align??'start';
  }
  return visible.some(s=>!['container','text','callout','hero','heading'].includes(s.kind)||s.kind==='hero'&&s.assetId)?'start':'center';
}
