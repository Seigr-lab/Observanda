// Retained figures keep their immutable data and editable presentation in
// separate counted documents. These checks validate wire shapes only; callers
// must resolve the containing record/material through its authorized owner.
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validFigureSource} from './figure-provenance.js';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const root=value=>exact(value,['root','index'])&&revisionId(value.root)&&revisionId(value.index);
export const RETAINED_FIGURE_WINDOW=128;
export const RETAINED_FIGURE_TEXT_WINDOW=16384;
const countKeys=Object.freeze(['panels','series','points','annotations','ticks']);
export const RETAINED_FIGURE_COLLECTIONS=Object.freeze([...countKeys,'categories']);
export const isRetainedFigure=value=>value?.kind==='retained';
export const validRetainedFigureTextValue=value=>typeof value==='string'?text(value):exact(value,['format','version','preview','characters'])&&value.format==='figure-text'&&value.version===1&&text(value.preview)&&value.preview.length<=512&&Number.isSafeInteger(value.characters)&&value.characters>1024;
export function validRetainedFigureCounts(value){
 return exact(value,countKeys)&&countKeys.every(key=>natural(value[key]))&&value.panels>0&&value.series>0;
}
export function validRetainedFigureDocument(value){
 return exact(value,['format','version','data','presentation','counts'])&&value.format==='figure-document'&&value.version===1&&root(value.data)&&root(value.presentation)&&validRetainedFigureCounts(value.counts);
}
export function validRetainedFigure(value,{draft=false}={}){
 return exact(value,['id','title','kind','version','document',...(Object.hasOwn(value??{},'source')?['source']:[])])&&researchId(value.id)&&validRetainedFigureTextValue(value.title)&&(draft||typeof value.title!=='string'||!!value.title.trim())&&value.kind==='retained'&&value.version===1&&validRetainedFigureDocument(value.document)&&(!Object.hasOwn(value,'source')||validFigureSource(value.source));
}
export function validRetainedFigureWindow(value){
 if(!object(value)||Object.keys(value).some(key=>!['collection','plotId','seriesId','offset','limit'].includes(key))||!RETAINED_FIGURE_COLLECTIONS.includes(value.collection))return false;
 if(value.plotId!==undefined&&!researchId(value.plotId)||value.seriesId!==undefined&&!researchId(value.seriesId))return false;
 if(value.seriesId!==undefined&&value.collection!=='points')return false;
 return natural(value.offset??0)&&Number.isSafeInteger(value.limit??16)&&(value.limit??16)>0&&(value.limit??16)<=RETAINED_FIGURE_WINDOW;
}
export function validRetainedFigureItem(value){
 if(!object(value)||Object.keys(value).some(key=>!['collection','plotId','seriesId','id'].includes(key))||!researchId(value.id))return false;
 const {id,...selection}=value;return validRetainedFigureWindow(selection);
}
export function validRetainedFigureText(value){
 if(!object(value)||Object.keys(value).some(key=>!['collection','plotId','seriesId','id','field','offset','limit'].includes(key))||typeof value.field!=='string'||value.field.length>256||!/^([a-zA-Z][a-zA-Z0-9]*|[0-9]+)(\.([a-zA-Z][a-zA-Z0-9]*|[0-9]+))*$/.test(value.field)&&!(value.collection==='categories'&&value.field===''))return false;
 const {field,offset=0,limit=RETAINED_FIGURE_TEXT_WINDOW,...selection}=value;
 const validSelection=selection.collection==='header'?researchId(selection.id)&&selection.seriesId===undefined&&(selection.plotId===undefined||researchId(selection.plotId)):validRetainedFigureItem(selection);
 return validSelection&&natural(offset)&&Number.isSafeInteger(limit)&&limit>0&&limit<=RETAINED_FIGURE_TEXT_WINDOW;
}
