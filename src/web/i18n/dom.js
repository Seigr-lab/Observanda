import {messageLanguage,t} from './index.js';

// Bind interface text, never form values or authored content. Existing controls
// stay mounted when a language changes while Help is open.
export function messageText(namespace,key,esc,parameters={}){
 return `<span data-i18n-text="${namespace}:${key}" data-i18n-parameters="${esc(JSON.stringify(parameters))}" lang="${messageLanguage(namespace)}">${esc(t(namespace,key,parameters))}</span>`;
}
export function messageAttribute(namespace,key,attribute,esc){
 if(!['placeholder','aria-label','title'].includes(attribute))throw new TypeError('Unsupported translated attribute');
 return `data-i18n-${attribute}="${namespace}:${key}" ${attribute}="${esc(t(namespace,key))}"`;
}
export function setMessage(node,namespace,key,parameters={}){
 node.dataset.i18nText=namespace+':'+key;node.dataset.i18nParameters=JSON.stringify(parameters);
 node.textContent=t(namespace,key,parameters);node.lang=messageLanguage(namespace);
}
export function refreshMessages(root=document){
 for(const node of root.querySelectorAll('[data-i18n-text]')){
  const [namespace,key]=node.dataset.i18nText.split(':');setMessage(node,namespace,key,JSON.parse(node.dataset.i18nParameters??'{}'));
 }
 for(const attribute of ['placeholder','aria-label','title'])for(const node of root.querySelectorAll(`[data-i18n-${attribute}]`)){
  const [namespace,key]=node.getAttribute('data-i18n-'+attribute).split(':');node.setAttribute(attribute,t(namespace,key));
 }
 for(const node of root.querySelectorAll('[data-i18n-region]'))node.lang=messageLanguage(node.dataset.i18nRegion);
}
