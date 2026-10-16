import {hasHomepage} from './website-layouts.js';

export const WEBSITE_PAGE_LIMIT=25;
const collections={page:'pages',project:'projects',notebook:'notebooks',entry:'entries'};
const targetFor=(kind,item)=>({target:kind+':'+item.id,title:item.title,path:collections[kind]+'/'+item.id+'.html'});
export function websitePageTarget(book,target){
 if(target==='home')return hasHomepage(book)?{target,title:'Home',path:'index.html'}:null;
 if(typeof target!=='string')return null;
 const match=/^(page|project|notebook|entry):([a-f0-9-]{36})$/.exec(target);if(!match)return null;
 const [,kind,id]=match,items=book[collections[kind]];
 const item=items?.find(item=>item.id===id);return item?targetFor(kind,item):null;
}
export function websitePageAtPath(book,path){
 if(path==='index.html')return websitePageTarget(book,'home');
 const match=/^(pages|projects|notebooks|entries)\/([a-f0-9-]{36})\.html$/.exec(path??'');
 if(!match)return null;
 const kind=Object.keys(collections).find(key=>collections[key]===match[1]);return websitePageTarget(book,kind+':'+match[2]);
}
export function* websitePageTargets(book,{kind='all'}={}){
 if(['all','site','structure'].includes(kind)&&hasHomepage(book))yield websitePageTarget(book,'home');
 for(const key of Object.keys(collections))if(kind==='all'||kind==='structure'&&key!=='entry'||kind===key||kind==='site'&&key==='page'){
  for(const item of book[collections[key]])yield targetFor(key,item);
 }
}
// The native selector is a short list, not another copy of the catalogue.
// A selected page stays present even when it is outside that first window.
export function websitePageChoices(book,path,limit=WEBSITE_PAGE_LIMIT){
 const choices=[];let more=false;
 for(const target of websitePageTargets(book)){if(choices.length===limit){more=true;break;}choices.push(target);}
 const selected=websitePageAtPath(book,path);
 if(selected&&!choices.some(item=>item.path===path))choices.unshift(selected);
 return {choices,more};
}
// Structural pages include unsaved authored pages. A window retains at most
// limit labels, never record bodies or an array of every matching destination.
export function websitePageWindow(book,{kind,search='',offset=0,limit=WEBSITE_PAGE_LIMIT}){
 const needle=search.trim().toLocaleLowerCase(),items=[];let total=0;
 for(const item of websitePageTargets(book,{kind})){
  if(!item.title.toLocaleLowerCase().includes(needle))continue;
  if(total>=offset&&items.length<limit)items.push(item);total++;
 }
 return {items,total,offset,previousCursor:offset?Math.max(0,offset-limit):null,nextCursor:offset+items.length<total?offset+limit:null};
}
