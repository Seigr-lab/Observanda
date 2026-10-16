import {BUNDLED_FONTS} from './bundled-fonts.js';
export {BUNDLED_FONTS};
export const customFontId=value=>typeof value==='string'&&/^custom-[a-f0-9]{64}$/.test(value);
export const FONT_STACKS=Object.fromEntries(BUNDLED_FONTS.map(f=>[f.id,JSON.stringify(f.family)+(['atkinson','space-grotesk','dm-sans','poiret-one','amatic-sc','rubik-dirt','sue-ellen-francisco','reenie-beanie'].includes(f.id)?',sans-serif':',serif')]));
Object.assign(FONT_STACKS,{modern:'system-ui,sans-serif',editorial:'Georgia,serif'});
export const FONT_OPTIONS=[...BUNDLED_FONTS.map(f=>[f.id,f.family]),['modern','System sans serif'],['editorial','System serif']];
export const validFont=id=>typeof id==='string'&&(Object.hasOwn(FONT_STACKS,id)||customFontId(id));
export const fontFamily=id=>customFontId(id)?'Observanda '+id:BUNDLED_FONTS.find(f=>f.id===id)?.family;
export const fontStack=id=>customFontId(id)?JSON.stringify(fontFamily(id))+',serif':FONT_STACKS[id];
let custom=[];
export function fontLabel(font){const format=font.faces[0].file.split('.').at(-1).toUpperCase(),duplicate=custom.some(f=>f.id!==font.id&&f.label===font.label&&f.faces[0].file.endsWith('.'+format.toLowerCase()));return `${font.label} (${format}${duplicate?' · '+font.id.slice(7,15):''})`;}
export function setCustomFonts(fonts){custom=fonts;FONT_OPTIONS.splice(BUNDLED_FONTS.length+2);FONT_OPTIONS.push(...fonts.filter(f=>!f.hidden).map(f=>[f.id,fontLabel(f)]));}
export const fontInfo=id=>BUNDLED_FONTS.find(f=>f.id===id)??custom.find(f=>f.id===id);
export const fontAxes=id=>fontInfo(id)?.faces[0]?.axes??{};
export const validAxes=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=16&&Object.entries(value).every(([tag,n])=>/^[A-Za-z][A-Za-z0-9]{3}$/.test(tag)&&Number.isFinite(n)&&n>=-32768&&n<=32767);
export function validCustomFont(font){
 if(!font||!customFontId(font.id)||typeof font.label!=='string'||!font.label.length||font.label.length>160||!['embed','restricted','hidden'].every(k=>typeof font[k]==='boolean')||!Array.isArray(font.faces)||font.faces.length!==1)return false;
 const face=font.faces[0];if(!face||!['ttf','otf','woff','woff2'].some(ext=>face.file===font.id+'.'+ext)||!['normal','italic'].includes(face.style)||!Array.isArray(face.weight)||![1,2].includes(face.weight.length)||!face.weight.every(w=>Number.isFinite(w)&&w>=1&&w<=1000)||face.weight[0]>face.weight.at(-1)||!face.axes||Array.isArray(face.axes)||typeof face.axes!=='object'||Object.keys(face.axes).length>16)return false;
 return Object.entries(face.axes).every(([tag,a])=>/^[A-Za-z][A-Za-z0-9]{3}$/.test(tag)&&a&&typeof a.name==='string'&&a.name.length<=160&&[a.min,a.default,a.max].every(Number.isFinite)&&a.min>=-32768&&a.max<=32767&&a.min<=a.default&&a.default<=a.max);
}
export function axesFitFont(id,axes){if(axes===undefined)return true;if(!validAxes(axes))return false;const definition=fontInfo(id);return !definition||Object.entries(axes).every(([tag,n])=>{const axis=definition.faces[0].axes[tag];return axis&&n>=axis.min&&n<=axis.max;});}
export function variationCSS(axes={}){return Object.entries(axes).filter(([tag])=>tag!=='wght').map(([tag,n])=>'"'+tag+'" '+n).join(',')||'normal';}
export function faceCSS(id,face,url){
 const family=fontFamily(id),format={ttf:'truetype',otf:'opentype',woff:'woff',woff2:'woff2'}[face.file.split('.').at(-1)];
 return `@font-face{font-family:${JSON.stringify(family)};src:url("${url}") format("${format}");font-style:${face.style};font-weight:${face.weight.join(' ')};${face.axes.wdth?`font-stretch:${face.axes.wdth.min}% ${face.axes.wdth.max}%;`:''}font-display:swap}`;
}
