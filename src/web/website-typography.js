import {validFont,validAxes} from './font-catalogue.js';

export const TYPOGRAPHY_RANGES = {fontSize:[12,40,1],lineHeight:[1,2.5,.05],headingScale:[.5,2,.05],letterSpacing:[-1,4,.1],paragraphSpacing:[0,3,.1]};
export function validTypography(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,v])=>
    ['font','headingFont'].includes(key)?validFont(v):['fontAxes','headingFontAxes'].includes(key)?validAxes(v):Object.hasOwn(TYPOGRAPHY_RANGES,key)&&Number.isFinite(v)&&v>=TYPOGRAPHY_RANGES[key][0]&&v<=TYPOGRAPHY_RANGES[key][1]&&(key!=='fontSize'||Number.isInteger(v)));
}
export const websiteTypography=book=>({font:book.appearance.font,headingFont:book.appearance.headingFont,fontAxes:book.website.typography.font?{}:book.appearance.fontAxes??{},headingFontAxes:book.website.typography.headingFont?{}:book.appearance.headingFontAxes??{},fontSize:book.appearance.fontSize,lineHeight:book.appearance.lineHeight,headingScale:1,letterSpacing:0,paragraphSpacing:1,...book.website.typography});

export const WEBSITE_COLORS=['background','surface','text','muted','accent','border'];
export const validPalette=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,v])=>WEBSITE_COLORS.includes(key)&&typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v));
