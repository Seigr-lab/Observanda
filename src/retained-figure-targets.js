// Public figure targets are resolved through the already-authorized owner.
// Composition members use their pinned plot index; observation arrays are never read.
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {AppError} from './errors.js';
import {RETAINED_FIGURE_WINDOW} from './web/retained-figure-model.js';
const text=value=>typeof value==='string'?value.length>512?value.slice(0,512)+'...':value:value?.format==='figure-text'?value.preview+'...':'';
function owner(value){const workspace=value?.store?.workspace??value?.workspace??value;if(typeof workspace?.readMetadata!=='function')throw new AppError('INVALID');return workspace;}
const rootTarget=figure=>({id:figure.id,title:text(figure.title)});
const panelTarget=(figure,panel)=>({id:panel.plotId,title:[text(figure.title),text(panel.value.label),text(panel.value.header.title)].filter(Boolean).join(' / ')});
async function reader(workspace,figure,{signal,draft=false}={}){signal?.throwIfAborted();return new RetainedFigureDocuments(owner(workspace),{signal,readOnly:true}).open(figure,{draft});}
export async function* retainedFigureTargets(workspace,figure,{signal,draft=false}={}){
 signal?.throwIfAborted();if(!figure)return;
 if(figure.kind!=='retained'){yield rootTarget(figure);if(figure.kind==='panels')for(const panel of figure.panels){signal?.throwIfAborted();yield {id:panel.figure.id,title:[text(figure.title),text(panel.label),text(panel.figure.title)].filter(Boolean).join(' / ')};}return;}
 const r=await reader(workspace,figure,{signal,draft});yield rootTarget(figure);if((await r.header()).header.kind!=='panels')return;
 for await(const panel of r.memberRows({collection:'panels'})){signal?.throwIfAborted();yield panelTarget(figure,await r.expose(panel));}
}
export async function findRetainedFigureTarget(workspace,figure,id,{signal,draft=false}={}){
 signal?.throwIfAborted();if(!figure||!id)return null;
 if(figure.kind!=='retained'){if(figure.id===id)return rootTarget(figure);if(figure.kind==='panels')for(const panel of figure.panels){signal?.throwIfAborted();if(panel.figure.id===id)return {id,title:[text(figure.title),text(panel.label),text(panel.figure.title)].filter(Boolean).join(' / ')};}return null;}
 const r=await reader(workspace,figure,{signal,draft});if(figure.id===id)return rootTarget(figure);if((await r.header()).header.kind!=='panels')return null;const scope=await r.scope({collection:'panels',plotId:id});if(scope.total===0)return null;if(scope.total!==1)throw new AppError('MATERIAL_MISSING');const panel=await r.panelMember(id);if(panel.plotId!==id)throw new AppError('MATERIAL_MISSING');return panelTarget(figure,await r.expose(panel));
}
export async function hasRetainedFigureTarget(workspace,figure,id,options){return !!await findRetainedFigureTarget(workspace,figure,id,options);}

// Child choices are a bounded window of the same pinned composition index.
export async function retainedFigureRootTarget(workspace,figure,{signal,draft=false}={}){
 signal?.throwIfAborted();if(!figure)return null;
 if(figure.kind!=='retained')return {...rootTarget(figure),hasPanels:figure.kind==='panels'};
 const r=await reader(workspace,figure,{signal,draft});return {...rootTarget(figure),hasPanels:(await r.header()).header.kind==='panels'};
}
export async function retainedFigureTargetPage(workspace,figure,{offset=0,limit=4,signal,draft=false}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>RETAINED_FIGURE_WINDOW)throw new AppError('INVALID');signal?.throwIfAborted();
 let items=[],total=0;
 if(figure?.kind==='retained'){
  const r=await reader(workspace,figure,{signal,draft});if((await r.header()).header.kind==='panels'){
   total=r.document.counts.panels;offset=Math.min(offset,Math.max(0,total-1));const page=await r.window({collection:'panels',offset,limit});items=page.items.map(panel=>({...panelTarget(figure,panel),hasPanels:false}));
  }
 }else if(figure?.kind==='panels'){total=figure.panels.length;offset=Math.min(offset,Math.max(0,total-1));items=figure.panels.slice(offset,offset+limit).map(panel=>({id:panel.figure.id,title:[text(figure.title),text(panel.label),text(panel.figure.title)].filter(Boolean).join(' / '),hasPanels:false}));}
 offset=Math.min(offset,Math.max(0,total-1));return {items,offset,total,next:offset+items.length<total?offset+items.length:null,previous:offset?Math.max(0,offset-limit):null};
}
