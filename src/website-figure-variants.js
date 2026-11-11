import {LANGUAGES} from './web/i18n/runtime.js';

// A plotted figure on a website is an image file whose number labels are
// drawn in one language. A website copy carries one file per shipped language
// and names them on the image: "en url ca url ...". The page localizer
// (src/website-record-language.js) shows the file for the page's language.
export const figureVariantKey='data-observanda-figure-variants';
export const figureVariantLanguages=Object.freeze(LANGUAGES.map(language=>language.id));
const languagePattern=/^[a-z]{2,3}$/;
export function figureVariants(value){
 const tokens=String(value??'').trim().split(/\s+/).filter(Boolean),variants=new Map();
 if(tokens.length%2)return variants;
 for(let i=0;i<tokens.length;i+=2)if(languagePattern.test(tokens[i])&&!variants.has(tokens[i]))variants.set(tokens[i],tokens[i+1]);
 return variants;
}
export const formatFigureVariants=variants=>[...variants].map(([language,url])=>language+' '+url).join(' ');
export const mapFigureVariants=(value,map)=>formatFigureVariants(new Map([...figureVariants(value)].map(([language,url])=>[language,map(url)])));
