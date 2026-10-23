// Presentation controls address a single selected property; no observation
// arrays are sent back by the editor.
const property=(path,type='text',options)=>({path,type,label:path,options});
const numeric=paths=>paths.map(path=>property(path,'number'));
const bool=paths=>paths.map(path=>property(path,'boolean'));
export function retainedFigureProperties(part,value,header){
 if(!value)return [];
 if(part==='panels')return [property('label')];
 if(part==='series')return [property('name'),property('color','color'),...bool(['style.visible']),...numeric(['style.lineWidth','style.radius']),property('style.dash','choice',['solid','dashed','dotted']),property('style.marker','choice',['circle','square','diamond','none'])];
 if(part==='ticks')return [property('label'),property('axis','choice',['x','y']),property('value',value.axis==='x'&&header.x.kind!=='number'?'string':'number')];
 if(part==='annotations')return [property('label'),property('color','color'),...numeric(['opacity']),...(['boundary','interval'].includes(value.kind)?[property('axis','choice',['x','y']),property('start',value.axis==='x'&&header.x.kind==='date'?'string':'number'),...(value.kind==='interval'?[property('end',value.axis==='x'&&header.x.kind==='date'?'string':'number')]:[])]:value.kind==='region'?[...['xLower','xUpper'].map(path=>property(path,header.x.kind==='date'?'string':'number')),...numeric(['yLower','yUpper'])]:numeric(['dx','dy']))];
 if(value.kind==='panels')return [property('title'),...numeric(['layout.columns']),...bool(['layout.linkX','layout.linkY'])];
 const common=[property('title'),...bool(['legend']),property('x.label'),property('y.label'),...bool(['style.showTitle']),property('style.font','choice',['sans','serif','mono']),...numeric(['style.fontSize','style.titleSize','style.legendSize','style.width','style.height']),...['textColor','background','gridColor','axisColor'].map(key=>property('style.'+key,'color')),property('style.grid','choice',['none','y','both']),property('style.legendPosition','choice',['top','bottom','right']),property('style.labelRotation','choice',['auto','0','-45','-90']),...numeric(['style.labelStep']),property('style.numberFormat','choice',['auto','decimal','scientific','percent','radix']),...numeric(['style.radix','style.decimals']),property('style.dateFormat','choice',['date','month','year','datetime']),property('style.annotationLabels','choice',['auto','key','hidden'])];
 if(value.kind!=='heatmap')for(const axis of ['x','y'])common.push(property(axis+'.scale','choice',['linear','log']),property(axis+'.min',axis==='x'&&value.x.kind==='date'?'string':'number'),property(axis+'.max',axis==='x'&&value.x.kind==='date'?'string':'number'),property(axis+'.reversed','boolean'));
 if(value.markerArea)common.push(property('markerArea.label'),...numeric(['markerArea.unitArea']));
 if(value.heatmap)common.push(property('heatmap.valueLabel'),property('heatmap.missingColor','color'),property('heatmap.showValues','boolean'));
 return common;
}
