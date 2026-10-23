// Selected edits change only presentation. All data roots and source locators
// are resolved by the admitted owner, never supplied by the request.
import {researchId} from './research-reference.js';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const collections=['header','panels','series','annotations','ticks'];
const exact=(value,allowed,required)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
export function validRetainedFigureOperation(value){
 if(!object(value)||!collections.includes(value.collection)||value.id!==undefined&&!researchId(value.id)||value.plotId!==undefined&&!researchId(value.plotId))return false;
 const scope=['type','collection','id','plotId'];
 if(value.collection!=='header'&&value.type!=='append'&&!researchId(value.id))return false;
 if(value.type==='threshold')return value.collection==='header'&&exact(value,[...scope,'index','patch'],['type','collection','index','patch'])&&Number.isInteger(value.index)&&value.index>=0&&value.index<32&&exact(value.patch,['max','color'],[])&&Object.keys(value.patch).length>0;
 if(value.type==='patch')return exact(value,[...scope,'patch'],['type','collection','patch'])&&object(value.patch)&&Object.keys(value.patch).length>0;
 if(value.type==='text')return exact(value,[...scope,'field','offset','remove','text'],['type','collection','field','offset','remove','text'])&&typeof value.field==='string'&&value.field.length<=64&&natural(value.offset)&&natural(value.remove)&&typeof value.text==='string'&&value.text.length<=16384;
 if(value.type==='append')return ['annotations','ticks'].includes(value.collection)&&exact(value,[...scope,'value'],['type','collection','plotId','value'])&&researchId(value.plotId)&&value.id===undefined&&object(value.value);
 if(value.type==='remove')return ['annotations','ticks'].includes(value.collection)&&exact(value,scope,['type','collection','id']);
 return value.type==='move'&&value.collection!=='header'&&exact(value,[...scope,'direction'],['type','collection','id','direction'])&&[-1,1].includes(value.direction);
}
