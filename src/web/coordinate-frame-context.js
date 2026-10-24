import {t} from './i18n/index.js';
import {COORDINATE_FRAME_METHOD} from './coordinate-frame-model.js';
const message=(key,args)=>t('coordinateFrames',key,args);
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
const label=(value,max,{empty=false}={})=>typeof value==='string'&&value.length<=max&&(empty||!!value.trim())&&!/[\u0000-\u001f]/u.test(value);
function admitted(context){return keys(context,['namespace','dimension','unit','method','sourceNamespace','axes'])&&label(context.namespace,200)&&Number.isSafeInteger(context.dimension)&&context.dimension>0&&label(context.unit,100,{empty:true})&&(context.method===undefined?context.sourceNamespace===undefined:context.method===COORDINATE_FRAME_METHOD&&(context.sourceNamespace===undefined||label(context.sourceNamespace,200)));}
function axisPage(context){const page=context.axes;return keys(page,['offset','items','total'])&&Number.isSafeInteger(page.offset)&&page.offset>=0&&page.total===context.dimension&&Array.isArray(page.items)&&page.items.length<=16&&page.offset+page.items.length<=page.total&&page.items.every(item=>keys(item,['name'])&&label(item.name,200));}
// Callers supply an authorized public projection, never the private frame descriptor.
// An axis page is labelled as a page and is never presented as the complete axis set.
export function coordinateFrameAxisPageParts(context,{text=message}={}){if(!admitted(context)||!axisPage(context))return [];const page=context.axes;return [text('publicAxisPage',{first:page.items.length?page.offset+1:0,last:page.offset+page.items.length,total:page.total}),...page.items.map((item,index)=>text('publicAxis',{position:page.offset+index+1,name:item.name}))];}
export function coordinateFrameAxisPageText(context,options){return coordinateFrameAxisPageParts(context,options).join('\n');}
export function coordinateFrameContextParts(context,{text=message}={}){if(!admitted(context)||context.axes!==undefined&&!axisPage(context))return [];const unit=context.unit?text('publicUnit',{unit:context.unit}):text('publicNoUnit'),parts=[text(context.method?(context.sourceNamespace?'publicTransformContext':'publicTargetTransformContext'):'publicContext',{namespace:context.namespace,dimension:context.dimension,unit,...(context.sourceNamespace?{sourceNamespace:context.sourceNamespace}:{})})];if(context.axes)parts.push(...coordinateFrameAxisPageParts(context,{text}));return parts;}
export function coordinateFrameContextText(context,options){return coordinateFrameContextParts(context,options).join('\n');}

export function coordinateFrameLineageView(item,{esc,text=message}={}){
 if(item?.coordinateTransform?.version===1&&item.coordinateTransform.method===COORDINATE_FRAME_METHOD)return '<p data-coordinate-transform-lineage>'+esc(text('lineageTransform'))+'</p>';
 const component=item?.coordinateComponent;if(component?.version===1&&Number.isSafeInteger(component.axis)&&component.axis>=0)return '<p data-coordinate-component-lineage>'+esc(text('lineageComponent',{axis:component.axis+1}))+'</p>';
 return '';
}
