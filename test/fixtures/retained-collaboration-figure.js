import {randomUUID} from 'node:crypto';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {changeRetainedFigure} from '../../src/retained-figure-presentation.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {RecordValues} from '../../src/record-values.js';
import {createFigure} from '../../src/web/figure-model.js';

export async function retainedCollaborationFigure(workspace,workspaceId,recordId,{points=137,title='Retained shared observations',nested=false}={}){
 const figure=createFigure();figure.title=title;figure.series[0].points=Array.from({length:points},(_,x)=>({x,y:x%17,error:x===points-1?1:null}));
 const materials=new ResearchMaterials(workspace),retained=await workspace.withLock(()=>new RetainedFigureDocuments(workspace).retain(figure)),source=await workspace.withLock(()=>materials.commit({kind:'analysis',recordId,title,content:{inputs:[],outputs:[],tool:'Synthetic shared figure',version:'1',parameters:'Exact retained observations',figure:retained}}));
 let presentation=retained;if(nested){const label='Edited shared coordinate';presentation=await workspace.withLock(()=>changeRetainedFigure(new RetainedFigureDocuments(workspace),retained,{type:'text',collection:'header',field:'x.label',offset:0,remove:figure.x.label.length,text:label}));figure.x.label=label;}
 const values=new RecordValues(workspace),target={workspaceId,recordId,field:'figure:'+figure.id},base=await values.read(target),attached={...presentation,source};await values.save({...target,expectedRevision:base.revision,value:{value:attached}});
 let composition=null;if(nested){const inline=createFigure();inline.series[0].points=[{x:0,y:1,error:null}];composition={id:randomUUID(),title:'Mixed shared composition',kind:'panels',layout:{columns:2,linkX:false,linkY:false},panels:[{id:randomUUID(),label:'A',figure:attached},{id:randomUUID(),label:'B',figure:inline}]};const record=(await workspace.read()).book.entries.find(row=>row.id===recordId);await new ResearchRecords(workspace,{}).save({workspaceId,changes:[{id:recordId,expectedRevision:recordRevision(record),record:{...record,figures:record.figures.map(item=>item.id===figure.id?composition:item)}}]});}
 return {figure,retained:attached,source,materials,composition};
}
