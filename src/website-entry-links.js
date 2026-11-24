import {parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {attr,put,words,descendants} from './website-migration-views.js';

const prefix='data-observanda-link';
export const linkSource=node=>attr(node,prefix);
const keyOf=node=>attr(node,prefix+'-key');
const text=value=>({nodeName:'#text',value});
function setChildren(node,children){node.childNodes=children;for(const child of children)child.parentNode=node;}

export function linkPlacement(node,prior){
 const id=linkSource(node),key=keyOf(node),revision=attr(node,prefix+'-revision'),href=attr(node,'href')??prior?.get(key)?.href;
 if(node.tagName!=='a'||!/^\d+$/.test(key??'')||!href||!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(revision??''))throw new AppError('INVALID');
 return {id,revision,link:key,href};
}

export function linkShape(node){
 const hidden=attr(node,prefix+'-blocked')!==undefined,attributes=node.attrs.map(({name,value})=>[name,value]).sort();
 const titles=[...descendants(node)].filter(n=>attr(n,prefix+'-title')!==undefined);
 const hiddenAttributes=hidden?[...descendants(node)].filter(n=>n!==node&&n.tagName).map(n=>n.attrs):null;
 return JSON.stringify([attributes,titles.map(n=>attr(n,prefix+'-title')),hiddenAttributes,hidden?(attr(node,prefix+'-label')==='title'?words(node):titles.map(words)):null]);
}

export function updateEntryLink(node,placement,{html,previousHtml,visible,revision},projection){
 if(!placement)throw new AppError('FORMAT');
 if(!projection.value){
  const nodes=[...descendants(parseFragment(html))];
  const title=nodes=>words(nodes.find(child=>attr(child,'data-observanda-part')==='title'));
  projection.value={title:title(nodes),priorTitle:title([...descendants(parseFragment(previousHtml))]),anchors:new Set(nodes.map(child=>attr(child,'id')).filter(Boolean))};
 }
 const {title,priorTitle,anchors}=projection.value,fragment=placement.href.split('#')[1],blocked=attr(node,prefix+'-blocked')!==undefined;
 const show=visible&&(!/^record-(section|figure)-/.test(fragment??'')||anchors.has(fragment));
 if(show){node.attrs=node.attrs.filter(a=>a.name!==prefix+'-blocked');put(node,'href',placement.href);}
 else{
  node.attrs=node.attrs.filter(a=>a.name.startsWith(prefix));put(node,prefix+'-blocked','1');
  for(const child of descendants(node))if(child!==node&&child.attrs)child.attrs=child.attrs.filter(a=>a.name===prefix+'-title');
 }
 put(node,prefix+'-revision',revision);
 if(show&&!blocked&&priorTitle===title)return serializeOuter(node);
 if(attr(node,prefix+'-label')==='title')setChildren(node,show?[text(title)]:[]);
 else{
  const seen=new Set();
  for(const part of descendants(node)){const group=attr(part,prefix+'-title');if(group===undefined)continue;setChildren(part,show&&!seen.has(group)?[text(title)]:[]);seen.add(group);}
 }
 return serializeOuter(node);
}
