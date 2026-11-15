// App themes: the starting themes plus the author's own, saved on this computer
// with the other app settings. Every colour, font and shape of the app comes
// from the active theme, so a theme the author makes applies everywhere.
import {STARTING_THEMES,startingAppearance} from './themes.js';
import {validFont,axesFitFont} from './font-catalogue.js';

export const APP_THEME_COLORS=['accent','background','surface','text','muted','border'];
export const APP_THEME_KEYS=['base',...APP_THEME_COLORS,'font','headingFont','radius','density'];
const hex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

export function appThemeFromStarting(name){
 const a=startingAppearance(name);
 return {base:name,...Object.fromEntries(APP_THEME_COLORS.map(key=>[key,a[key]])),font:a.font,headingFont:a.headingFont,...(a.fontAxes?{fontAxes:a.fontAxes}:{}),...(a.headingFontAxes?{headingFontAxes:a.headingFontAxes}:{}),radius:a.radius,density:a.density};
}
export function validAppTheme(theme){
 if(!theme||typeof theme!=='object'||Array.isArray(theme))return false;
 const keys=Object.keys(theme);
 if(!APP_THEME_KEYS.every(key=>keys.includes(key))||keys.some(key=>!APP_THEME_KEYS.includes(key)&&!['fontAxes','headingFontAxes'].includes(key)))return false;
 return Object.hasOwn(STARTING_THEMES,theme.base)&&APP_THEME_COLORS.every(key=>hex(theme[key]))
  &&['font','headingFont'].every(key=>validFont(theme[key])&&axesFitFont(theme[key],theme[key+'Axes']))
  &&Number.isInteger(theme.radius)&&theme.radius>=0&&theme.radius<=24&&['comfortable','compact'].includes(theme.density);
}
export function validAppThemes(list){
 if(!Array.isArray(list)||list.length>40)return false;
 const ids=new Set();
 for(const item of list){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join()!=='appearance,id,name'||!id(item.id)||ids.has(item.id)||Object.hasOwn(STARTING_THEMES,item.id))return false;
  if(typeof item.name!=='string'||!item.name.trim()||item.name.length>80||!validAppTheme(item.appearance))return false;
  ids.add(item.id);
 }
 return true;
}
// The theme in use: one of the author's own, or a starting theme.
export function activeAppTheme(settings){
 const own=(settings.appThemes??[]).find(item=>item.id===settings.appTheme);
 return own?structuredClone(own.appearance):appThemeFromStarting(Object.hasOwn(STARTING_THEMES,settings.appTheme)?settings.appTheme:'research');
}
export const appThemeChoice=(settings,value)=>Object.hasOwn(STARTING_THEMES,value)||(settings.appThemes??[]).some(item=>item.id===value);
