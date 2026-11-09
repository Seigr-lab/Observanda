import {websiteLayerAt} from './website-layer-model.js';
import {applyVisualStyle,readVisualStyle,visualClass,writeVisualStyle} from './website-files-visual-style.js';

const controlled='[data-observanda-source],[data-observanda-link],[data-observanda-part],[data-website-instance],[data-website-menu],[data-website-source-gallery],[data-website-feed]';
export function accessRepairKind(key,node){
 if(!node||node.closest(controlled))return null;
 if(key==='missingAlt'||key==='accessImageText')return 'image';
 if(['emptyLink','accessControlName','accessDialogName','accessLinkText'].includes(key))return 'name';
 if(key==='badHeading'||key==='accessMainHeading'&&node.matches('h1'))return 'heading';
 if(key==='accessContrast')return 'colors';
 if(['accessTarget','accessOverflow','accessTabOrder','accessFocus','accessDialog','accessMain'].includes(key)){
  if(key==='accessDialog'&&!node.matches('dialog'))return null;
  if(key==='accessMain'&&node.closest('article,aside,footer,header,nav'))return null;
  return key;
 }
 return null;
}
const styles={
 accessTarget:['ow-access-target','{box-sizing:border-box;display:inline-flex;align-items:center;min-inline-size:24px;min-block-size:24px}'],
 accessFocus:['ow-access-focus',':focus-visible{outline:3px solid white!important;outline-offset:2px!important;box-shadow:0 0 0 6px black!important}'],
 accessOverflow:['ow-access-fit','{box-sizing:border-box;max-inline-size:100%!important;min-inline-size:0!important;overflow-wrap:anywhere}']
};
export function applyAccessRepair(doc,issue,value,t,css){
 const node=issue.address===''?doc.body:websiteLayerAt(doc,issue.address);
 if(!node||node.localName!==issue.tag||accessRepairKind(issue.key,node)!==issue.repair)throw Error(t('changed'));
 switch(issue.repair){
  case 'image':
   if(value.decorative){node.alt='';node.setAttribute('role','presentation');}
   else{node.alt=value.text;node.setAttribute('role','img');}
   break;
  case 'name':node.setAttribute('aria-label',value.text);break;
  case 'heading':{
   const replacement=doc.createElement('h'+value.level);
   for(const {name,value} of node.attributes)replacement.setAttribute(name,value);
   replacement.append(...node.childNodes);node.replaceWith(replacement);break;
  }
  case 'accessMain':
   if(node===doc.body){
    const nodes=[...node.children].filter(child=>!child.matches('header,footer,nav,script,style,link,aside,.skip'));
    if(!nodes.length)throw Error(t('changed'));
    const contiguous=nodes.every((el,i)=>i===0||nodes[i-1].nextElementSibling===el);
    if(!contiguous)throw Error(t('accessSelectMain'));
    const main=doc.createElement('main');nodes[0].before(main);
    while(main.nextSibling){const next=main.nextSibling;main.append(next);if(next===nodes.at(-1))break;}
   }else{node.setAttribute('role','region');node.setAttribute('aria-label',value.text);}
   break;
  case 'accessDialog':{
   const form=doc.createElement('form'),close=doc.createElement('button');
   form.method='dialog';close.type='submit';close.textContent=value.text;form.append(close);node.append(form);break;
  }
  case 'accessTabOrder':node.removeAttribute('tabindex');if(node.tabIndex<0)node.tabIndex=0;break;
  case 'colors':{
   const id=visualClass(node)??'ow-visual-'+crypto.randomUUID(),style=readVisualStyle(doc,css,id);
   applyVisualStyle(style,[['color',value.ink],['background-color',value.paper]]);node.classList.add(id);
   return writeVisualStyle(css,id,style);
  }
  default:{
   const [name,body]=styles[issue.repair],rule='.'+name+body;node.classList.add(name);
   return css.includes(rule)?css:css+'\n'+rule+'\n';
  }
 }
 return null;
}
