import {plotDomains} from './figure-renderer.js';
import {linkedPanelPlots} from './figure-composition.js';

export const figurePreviewPointLimit=width=>Math.max(32,Math.min(128,Math.floor(width/12)));

// This is a view of the authored figure. Measurements, their order and the
// original export object remain untouched; numeric axes retain full ranges.
export function figurePreviewWindow(figure){
 const original=figure.kind==='panels'?figure.panels.map(panel=>panel.figure):[figure],ranges=new Map(),heatmaps=new Map();let plots=null,panel=0,series=0,offset=0;
 const domain=plot=>{if(!ranges.has(plot))ranges.set(plot,plotDomains(plot));return ranges.get(plot);};
 function points(plot,selected){
  if(plot.kind!=='heatmap')return selected.points;
  // Heatmaps define a cell by its final value at a category. Keep that rule
  // across page boundaries, including repeated authored category entries.
  if(!heatmaps.has(selected))heatmaps.set(selected,[...new Map(selected.points.map(point=>[point.x,point])).values()]);return heatmaps.get(selected);
 }
 function bounded(limit){let count=0,seriesCount=0;for(const plot of original){seriesCount+=plot.series.length;if(seriesCount>8)return false;for(const value of plot.series){count+=value.points.length;if(count>limit)return false;}}return true;}
 function view(width){
  const limit=figurePreviewPointLimit(width);if(bounded(limit))return {figure,paged:false};
  plots??=figure.kind==='panels'?linkedPanelPlots(figure,domain):original;
  const plot=plots[panel],selected=plot.series[series],values=points(plot,selected),total=values.length;offset=Math.min(offset,Math.max(0,total-1));
  const axes=domain(plot),axis=name=>({...plot[name],...(name==='x'&&plot.x.kind==='category'?{}:axes[name]),...(plot[name].ticks?{ticks:plot[name].ticks.slice(0,128)}:{})});
  return {paged:true,panel,panels:plots.length,series,seriesCount:plot.series.length,offset,total,limit,name:selected.name,panelLabel:figure.panels?.[panel]?.label??plot.title,heatmap:plot.kind==='heatmap',hidden:selected.style?.visible===false,
   figure:{...plot,x:axis('x'),y:axis('y'),annotations:[],series:[{...selected,points:values.slice(offset,offset+limit)}]}};
 }
 function select(kind,position,width){
  const current=view(width),total=kind==='panel'?current.panels:kind==='series'?current.seriesCount:kind==='observations'?current.total:0;
  if(!current.paged||!Number.isSafeInteger(position)||position<0||position>=total)return false;
  if(kind==='panel'){panel=position;series=0;offset=0;}else if(kind==='series'){series=position;offset=0;}else offset=position;return true;
 }
 return {view,select};
}
