import {homeIntroduction,siteIdentity} from './website-model.js';

// Local presentation feedback must not wait for a durable draft checkpoint.
// The server still validates and renders the draft; this changes no selection.
export function updateCanvasHomeHeader(document,book){
 if(document?.body?.dataset.page!=='home')return false;
 const container=document.querySelector('.page-frame'),main=document.querySelector('main');if(!container||!main)return false;
 const home=book.website.home,layout=book.website.layouts.find(value=>value.target==='home');
 const title=layout?.heading||(home.title??siteIdentity(book).title);
 const description=layout?.description||homeIntroduction(book),showTitle=layout?layout.showHeading:home.showTitle;
 let header=document.querySelector('.site-header');
 if(layout?.showHeading===false||!showTitle&&!description){header?.remove();}
 else{
  if(!header){header=document.createElement('header');header.className='site-header';container.before(header);}
  let heading=header.querySelector('h1'),introduction=header.querySelector('p');
  if(showTitle){if(!heading){heading=document.createElement('h1');header.prepend(heading);}heading.textContent=title;}else heading?.remove();
  if(description){if(!introduction){introduction=document.createElement('p');header.append(introduction);}introduction.textContent=description;}else introduction?.remove();
 }
 let accessible=main.querySelector(':scope > h1.visually-hidden');
 if(!showTitle){if(!accessible){accessible=document.createElement('h1');accessible.className='visually-hidden';main.prepend(accessible);}accessible.textContent=title;}else accessible?.remove();
 return true;
}
