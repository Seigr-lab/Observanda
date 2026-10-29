import {modelMessages} from './model-messages.js';
import {figureDataNumber} from './figure-number-labels.js';
import {figureStyle} from './figure-style.js';
import markerMessages from './locales/en/figureMarkerArea.json' with {type:'json'};
import {INTERVAL_FIELDS} from './figure-intervals.js';
import intervalMessages from './locales/en/figureIntervals.json' with {type:'json'};
import {figurePlots} from './figure-composition.js';
import {heatmapThresholdText} from './figure-heatmap.js';
import messages from './locales/en/figureHeatmap.json' with {type:'json'};
import composition from './locales/en/figureComposition.json' with {type:'json'};
export function heatmapCSV(figure){
 const rows=[[composition.panelData,composition.dataKind,composition.series,composition.x,composition.y,composition.uncertainty,messages.max,messages.color,messages.label,messages.valueLabel,...INTERVAL_FIELDS.map(k=>intervalMessages[k]),markerMessages.count,markerMessages.unitArea,markerMessages.label]];
 figurePlots(figure).forEach((plot,i)=>{const panel=figure.kind==='panels'?figure.panels[i].label:figure.title;
  for(const series of plot.series)for(const p of series.points)rows.push([panel,'measurement',series.name,p.x,p.y,p.error,'','','',plot.heatmap?.valueLabel??plot.y.label,...INTERVAL_FIELDS.map(k=>p[k]??null),p.count??null,plot.markerArea?.unitArea??null,plot.markerArea?.label??null]);
  if(plot.kind==='heatmap')for(const b of plot.heatmap.thresholds)rows.push([panel,'threshold','','','','',b.max,b.color,b.label,plot.heatmap.valueLabel]);
  for(const a of plot.annotations??[])rows.push([panel,a.kind,a.label,a.start,a.end,'','','',a.axis,'']);
 });
 return rows.map(row=>Array.from({length:rows[0].length},(_,i)=>row[i]??'').map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
export function heatmapThresholdTable(figure,esc,{translate}={}){const text=modelMessages('figureHeatmap',messages,translate);if(figure.kind!=='heatmap')return '';return '<table><caption>'+esc(text('thresholds'))+'</caption><thead><tr><th>'+esc(text('label'))+'</th><th>'+esc(text('max'))+'</th><th>'+esc(text('color'))+'</th></tr></thead><tbody>'+figure.heatmap.thresholds.map((b,i)=>'<tr><th scope="row">'+esc(b.label)+'</th><td>'+esc(heatmapThresholdText(figure.heatmap,i,value=>figureDataNumber(value,figureStyle(figure)),{translate}))+'</td><td>'+esc(b.color)+'</td></tr>').join('')+'</tbody></table>';}
