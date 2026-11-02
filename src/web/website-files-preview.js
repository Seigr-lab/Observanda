import {enhancePublicPopups} from './public-popups.js';
import {enhancePublicGalleries} from './public-gallery.js';
import {enhancePublicFeeds} from './public-feeds.js';
import {enhancePublicBook} from './public-book.js';
import {enhancePublicIndex} from './public-index.js';
import {matchesPublicRecord} from './public-browse-query.js';
import {savedPageLink} from './website-files-navigation.js';

// Keep arbitrary website scripts disabled in the frame. The same trusted
// controls used in publication may only request HTML from this saved revision.
export function enhanceSavedPreview(doc,{directory,pages,navigate,memory,failed}){
 const win=doc.defaultView,base=win.location.href;
 const page=href=>savedPageLink(href,base,directory,pages);
 const fetchPage=(href,{signal}={})=>{
  const target=page(href);if(!target)throw Error('Invalid saved page');
  return fetch(new URL(target.path,directory),{signal,redirect:'error'});
 };
 const location={
  get href(){return win.location.href;},set href(value){const target=page(value);if(target)navigate(target);},
  get search(){return win.location.search;},get pathname(){return win.location.pathname;},get protocol(){return win.location.protocol;}
 };
 const reader={fetch:fetchPage,DOMParser:win.DOMParser,AbortController:win.AbortController,addEventListener:win.addEventListener.bind(win),clearTimeout:win.clearTimeout.bind(win),setTimeout:win.setTimeout.bind(win)};
 const history={};
 for(const method of ['replaceState','pushState'])history[method]=(state,title,url)=>{if(page(url))win.history[method](state,title,url);};
 const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
 const enhance=fn=>{try{fn();}catch{failed();}};
 enhance(()=>enhancePublicGalleries(doc));
 if(doc.querySelector('[data-public-popup],.public-copy'))enhance(()=>enhancePublicPopups(doc));
 if(doc.querySelector('[data-public-feed]'))enhance(()=>enhancePublicFeeds(doc,win,fetchPage,{history:false}));
 if(doc.querySelector('[data-book-index],[data-book-browse]'))enhance(()=>enhancePublicBook(doc,location,history,storage,reader,matchesPublicRecord,enhancePublicIndex));
}
