// Compare a selected plot without hydrating its measurements or long labels.
// Presentation identities and private source receipts do not change a result.
import {createHash} from 'node:crypto';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
export async function figureCalculationFingerprint(workspace,figure,{plotId,signal}={}){
 const documents=new RetainedFigureDocuments(workspace,{signal});
 if(figure.kind!=='retained')figure=await documents.retain(figure);
 const reader=await documents.open(figure,{draft:true}),kind=(await reader.tree.selected(reader.presentation.header,['kind'])).value;
 if(kind!=='panels')plotId=(await reader.window({collection:'panels',limit:1})).items[0]?.plotId;
 if(!plotId)throw new AppError('INVALID');
 const panel=await reader.panelMember(plotId),hash=createHash('sha256');
 const value=async(root,path=[])=>{signal?.throwIfAborted();const selected=await reader.tree.select(root,path);if(!selected){hash.update('null');return;}if(selected.inline)hash.update(revisionText(selected.value));else for await(const chunk of reader.tree.json(selected.revision,{canonical:true,signal}))hash.update(chunk);};
 const object=async(root,path,skip=[])=>{const selected=await reader.tree.select(root,path),names=selected?.inline?Object.keys(selected.value):selected?await reader.tree.propertyNames(selected.revision):[];hash.update('{');for(const key of names.sort().filter(key=>!skip.includes(key))){hash.update(JSON.stringify(key)+':');await value(root,[...path,key]);hash.update(';');}hash.update('}');};
 for(const field of ['kind','x','y','summary','heatmap','markerArea','projection']){
  hash.update(field+':');await value(panel.body,['header',field]);hash.update(';');
 }
 for(const axis of ['x','y']){hash.update(axis+'Ticks:[');for await(const tick of reader.memberRows({collection:'ticks',plotId}))if((await reader.tree.selected(tick.body,['axis'])).value===axis){await object(tick.body,[],['axis']);hash.update(';');}hash.update(']');}
 hash.update('series:[');
 for await(const series of reader.memberRows({collection:'series',plotId})){
  hash.update('{name:');await value(series.body,['name']);hash.update(';points:[');
  for await(const point of reader.memberRows({collection:'points',plotId,seriesId:series.id})){await object(point.body,[],['source']);hash.update(';');}
  hash.update(']}');
 }
 hash.update(']');return hash.digest('hex');
}
