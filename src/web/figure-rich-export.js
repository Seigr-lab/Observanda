import {figurePlots} from './figure-composition.js';
import {observationPosition,observationAnnotation} from './figure-observation-annotations.js';
import composition from './locales/en/figureComposition.json' with {type:'json'};
import intervals from './locales/en/figureIntervals.json' with {type:'json'};
import markers from './locales/en/figureMarkerArea.json' with {type:'json'};
import observations from './locales/en/figureObservations.json' with {type:'json'};
// Extended CSV carries the complete scientific encoding beside measurements.
// JSON detail cells preserve typed settings rather than flattening them into prose.
export function richFigureCSV(figure){
 const rows=[[composition.panelData,composition.dataKind,composition.series,composition.x,composition.y,composition.uncertainty,intervals.xLower,intervals.xUpper,intervals.yLower,intervals.yUpper,markers.count,observations.encodingDetails]];
 for(const [i,f] of figurePlots(figure).entries()){
  const panel=figure.kind==='panels'?figure.panels[i].label:figure.title;
  rows.push([panel,'plot settings','','','','','','','','','',JSON.stringify({title:f.title,kind:f.kind,x:f.x,y:f.y,markerArea:f.markerArea??null,heatmap:f.heatmap??null,...(f.projection?{projection:f.projection}:{}),...(f.computation?{computation:f.computation}:{})})]);
  for(const s of f.series)for(const [index,p] of s.points.entries())rows.push([panel,'measurement',s.name,p.x,p.y,p.error,p.xLower,p.xUpper,p.yLower,p.yUpper,p.count,JSON.stringify({seriesId:s.id,pointIndex:index})]);
  for(const a of f.annotations??[])rows.push([panel,a.kind,a.label,'','','','','','','','',JSON.stringify({...a,...(observationAnnotation(a)?{position:observationPosition(a,f)}:{})})]);
 }
 return rows.map(row=>Array.from({length:rows[0].length},(_,i)=>'"'+String(row[i]??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
