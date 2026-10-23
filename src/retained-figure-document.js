import {createHash,randomUUID} from 'node:crypto';
import {validAuthoredPointOrigin} from './web/retained-figure-authoring-model.js';
import {RecordDocument} from './record-document.js';
import {recordTextJSON} from './record-string-stream.js';
import {sameAxisProjection} from './web/figure-projection-display.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RetainedFigureBlocks} from './retained-figure-blocks.js';
import {validRetainedFigure,validRetainedFigureDocument,validRetainedFigureWindow,validRetainedFigureItem,RETAINED_FIGURE_WINDOW} from './web/retained-figure-model.js';
import {xValue,figureIssues} from './web/figure-model.js';
import {pointIntervals,intervalIssues,INTERVAL_FIELDS} from './web/figure-intervals.js';
import {annotationIssues} from './web/figure-annotations.js';
import {axisControlIssues} from './web/figure-axis-controls.js';
import {researchId} from './web/research-reference.js';
import {revisionText} from './web/revision-model.js';
import {seriesStyle} from './web/figure-style.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const ordinal=n=>String(n).padStart(16,'0');
const identity=(...parts)=>{const hex=digest(serialize(parts));return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);};
const scalarHeader=figure=>{const result=Object.fromEntries(Object.entries(figure).filter(([key])=>!['series','panels','annotations','source'].includes(key)).map(([key,value])=>[key,structuredClone(value)]));for(const axis of ['x','y'])if(result[axis])delete result[axis].ticks;return result;};
const lengths=(value,path='',result={})=>{if(typeof value==='string')result[path]=value.length;else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value))lengths(child,path?path+'.'+key:key,result);return result;};
const emptyExtent=()=>({min:null,max:null,positiveMin:null,positiveMax:null});
const extent=(target,value)=>{if(typeof value!=='number'||!Number.isFinite(value))return;target.min=target.min===null?value:Math.min(target.min,value);target.max=target.max===null?value:Math.max(target.max,value);if(value>0){target.positiveMin=target.positiveMin===null?value:Math.min(target.positiveMin,value);target.positiveMax=target.positiveMax===null?value:Math.max(target.positiveMax,value);}};
const numericKey=value=>{const bytes=Buffer.alloc(8);bytes.writeDoubleBE(Object.is(value,-0)?0:value);if(bytes[0]&128)for(let i=0;i<8;i++)bytes[i]^=255;else bytes[0]^=128;return bytes.toString('hex');};

export const figureValidationValue=value=>value?.format==='figure-text'?'Retained text':Array.isArray(value)?value.map(figureValidationValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,figureValidationValue(child)])):value;
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const sample=header=>({x:header.x?.kind==='number'?1:header.x?.kind==='date'?'2000-01-01':'Category',y:1,error:null,...(header.markerArea?{count:1}:{})});
function validateHeader(header,{draft=false}={}){
 if(header.kind==='panels'){if(!researchId(header.id)||typeof header.title!=='string'||!draft&&!header.title.trim()||!header.layout||Object.keys(header.layout).sort().join()!=='columns,linkX,linkY'||!Number.isInteger(header.layout.columns)||header.layout.columns<1||header.layout.columns>3||typeof header.layout.linkX!=='boolean'||typeof header.layout.linkY!=='boolean'||Object.keys(header).some(key=>!['id','title','kind','layout'].includes(key)))invalid();return;}
 const series={id:header.id,name:'Validation',color:'#123456',points:[sample(header)]};if(figureIssues({...header,series:[series]},{retained:true,draft}).length)invalid();
}
export function validateRetainedFigurePoint(point,header){
 if(!point||typeof point!=='object'||Array.isArray(point))invalid();
 const keys=['x','y','error',...INTERVAL_FIELDS.filter(key=>Object.hasOwn(point,key)),...(Object.hasOwn(point,'count')?['count']:[])];
 const number=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e100;
 if(!point||Object.keys(point).sort().join()!==keys.sort().join()||xValue(point.x,header.x.kind)===null||!(point.y===null||number(point.y))||!(point.error===null||number(point.error)&&point.error>=0)||intervalIssues(point,header,xValue).length||point.count!==undefined&&point.count!==null&&(!Number.isSafeInteger(point.count)||point.count<0))invalid();
 if(header.x.scale==='log'&&xValue(point.x,header.x.kind)<=0||header.y.scale==='log'&&point.y!==null&&point.y-(point.error??0)<=0||header.kind==='heatmap'&&point.error!==null||header.markerArea&&point.y!==null&&(point.count==null||point.count*header.markerArea.unitArea>65536))invalid();
}

export class RetainedFigureCollections{
 constructor(blocks){this.blocks=blocks;this.tree=blocks.tree();this.index=new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});this.collections={};this.indexes={};}
 collection(name){return this.collections[name]??={count:0,root:null};}
 indexesFor(name){return this.indexes[name]??={keys:null,plots:null,series:null,lookup:null,coordinates:null};}
 roots(){return [...Object.values(this.collections).map(value=>value.root),...Object.values(this.indexes).flatMap(value=>Object.values(value))];}
 async checkpoint(){await this.index.flushRoots(this.roots());}
 async find(name,key,slot='keys'){return this.index.find({root:this.indexesFor(name)[slot]},key);}
 async add(name,{id,plotId=null,seriesId=null,position,body,lookup=null,coordinate=null,categoryId=null,visiblePosition=null,bodyRoot=null,texts=null}){
  this.blocks.check();const collection=this.collection(name),indexes=this.indexesFor(name);if(await this.find(name,id))throw new AppError('MATERIAL_INVALID');
  const item={format:'figure-member',version:1,collection:name,id,plotId,seriesId,position:position??collection.count,ordinal:collection.count,...(categoryId?{categoryId}:{}),...(visiblePosition!==null?{visiblePosition}:{}),body:bodyRoot??await this.tree.retain(body),texts:texts??lengths(body)};
  const revision=await this.tree.retain(item);collection.root=await this.index.change(collection.root,ordinal(collection.count++),revision);
  indexes.keys=await this.index.change(indexes.keys,id,revision);
  if(plotId)indexes.plots=await this.index.change(indexes.plots,plotId+':'+ordinal(item.ordinal),revision);
  if(seriesId)indexes.series=await this.index.change(indexes.series,seriesId+':'+ordinal(item.position),revision);
  if(lookup!==null)indexes.lookup=await this.index.change(indexes.lookup,lookup,revision);
  if(coordinate!==null)indexes.coordinates=await this.index.change(indexes.coordinates,plotId+':'+numericKey(coordinate)+':'+ordinal(item.ordinal),revision);
  if(this.index.pending.size>=128||this.index.pendingBytes>=262144)await this.checkpoint();return item;
 }
 async manifests(){await this.checkpoint();return {collections:this.collections,index:await this.tree.retain({format:'figure-index',version:1,collections:this.indexes})};}
}
export class RetainedFigureBuilder{
 constructor(owner,header,{draft=false,retained=null}={}){this.draft=draft;this.retained=retained;this.owner=owner;this.blocks=owner.blocks;this.tree=this.blocks.tree();this.header=scalarHeader(header);validateHeader(this.header,{draft});this.source=header.source?structuredClone(header.source):null;this.data=new RetainedFigureCollections(this.blocks);this.presentation=new RetainedFigureCollections(this.blocks);this.plot=null;this.series=null;this.done=false;}
 async addPlot(figure,{id=figure.id,label=figure.title,retained=null}={}){
  if(this.done)throw new AppError('INVALID');await this.finishPlot();validateHeader(scalarHeader(figure),{draft:this.draft});
  this.plot={id:figure.id,panelId:id,label,retained,header:scalarHeader(figure),slots:{annotations:Object.hasOwn(figure,'annotations'),xTicks:Object.hasOwn(figure.x??{},'ticks'),yTicks:Object.hasOwn(figure.y??{},'ticks')},domains:{x:emptyExtent(),y:emptyExtent(),minimumXGap:null,minimumLogXGap:null,categoryCount:0,visibleSeriesCount:0,maximumCategoryLength:0,maximumSeriesNameLength:0},series:0,points:0};
  for(const axis of ['x','y'])for(const [position,tick] of (figure[axis]?.ticks??[]).entries()){if(axisControlIssues({...figure[axis],ticks:[tick]},{kind:figure[axis].kind??'number',retained:true}).length)invalid();const tickKey=figure.id+':'+axis+':'+numericKey(tick.value);if(await this.presentation.find('ticks',tickKey,'lookup'))invalid();await this.presentation.add('ticks',{lookup:tickKey,id:identity(figure.id,axis,position),plotId:figure.id,position,body:{axis,...tick}});extent(this.plot.domains[axis],tick.value);}
  for(const [position,annotation] of (figure.annotations??[]).entries())await this.presentation.add('annotations',{id:annotation.id,plotId:figure.id,position,body:annotation});
 }
 async addSeries(series,{retained=null}={}){
  if(!this.plot||this.done)throw new AppError('INVALID');await this.finishSeries();
  const {points,...body}=series;if(figureIssues({...this.plot.header,series:[{...body,points:[sample(this.plot.header)]}]},{retained:true,draft:this.draft}).length)invalid();const nameKey=this.draft?null:this.plot.id+':'+(retained?.nameHash??digest(serialize(body.name)));if(nameKey!==null&&await this.presentation.find('series',nameKey,'lookup'))invalid();this.series={id:series.id,position:this.plot.series++,visible:seriesStyle(series).visible,points:0,complete:0,domains:{x:emptyExtent(),y:emptyExtent()}};
  if(this.series.visible){this.series.visiblePosition=this.plot.domains.visibleSeriesCount++;this.plot.domains.maximumSeriesNameLength=Math.max(this.plot.domains.maximumSeriesNameLength,retained?.texts.name??series.name.length);}
  await this.presentation.add('series',{id:series.id,plotId:this.plot.id,position:this.series.position,visiblePosition:this.series.visiblePosition??null,body,lookup:nameKey,...(retained?{bodyRoot:retained.root,texts:retained.texts}:{})});
 }
 async addPoint(point,{id=randomUUID(),source=null,retained=null}={}){
  if(!this.series||this.done)throw new AppError('INVALID');const plot=this.plot,series=this.series;if(this.draft){if(figureIssues({...plot.header,series:[{id:series.id,name:'Draft',color:'#123456',points:[point]}]},{retained:true,draft:true}).length)invalid();}else validateRetainedFigurePoint(point,plot.header);if(point.y!==null)series.complete++;const coordinate=xValue(point.x,plot.header.x.kind);
  if(!this.draft&&coordinate===null||point.y!==null&&(!Number.isFinite(point.y)||Math.abs(point.y)>1e100))throw new AppError('MATERIAL_INVALID');
  const categoryId=retained?.categoryId??identity(plot.id,point.x),lookup=plot.id+':'+series.id+':'+categoryId;if(!this.draft&&plot.header.kind==='heatmap'&&await this.data.find('points',lookup,'lookup'))invalid();
  const member=await this.data.add('points',{id,plotId:plot.id,seriesId:series.id,position:series.points++,categoryId,body:{...point,...(source?{source}:{} )},...(retained?{bodyRoot:retained.root,texts:retained.texts}:{}),lookup,coordinate:typeof coordinate==='number'?coordinate:null});plot.points++;
  const intervals=pointIntervals(point);for(const value of intervals.x){const x=xValue(value,plot.header.x.kind);extent(series.domains.x,x);if(series.visible)extent(plot.domains.x,x);}
  if(point.y!==null)for(const y of intervals.y){extent(series.domains.y,y);if(series.visible)extent(plot.domains.y,y);}
  if(series.visible&&plot.header.x.kind==='category'&&typeof point.x==='string'){
   const key=plot.id+':'+(retained?.xHash??digest(serialize(point.x))),found=await this.presentation.find('categories',key,'lookup');
   if(!found)await this.presentation.add('categories',{id:categoryId,plotId:plot.id,position:plot.domains.categoryCount++,body:point.x,lookup:key,...(retained?.xRoot?{bodyRoot:retained.xRoot,texts:{'':retained.texts.x}}:{})});
   plot.domains.maximumCategoryLength=Math.max(plot.domains.maximumCategoryLength,retained?.texts.x??point.x.length);
  }return member;
 }
 async finishSeries(){if(!this.series)return;if(!this.draft&&!this.series.complete&&this.plot.header.kind!=='heatmap')invalid();await this.data.add('series',{id:this.series.id,plotId:this.plot.id,position:this.series.position,body:{points:this.series.points,domains:this.series.domains}});this.series=null;}
 async finishPlot(){
  if(!this.plot)return;await this.finishSeries();const plot=this.plot;
  if(plot.header.x.kind!=='category'){
   const index=this.data.index,root=this.data.indexesFor('points').coordinates,prefix=plot.id+':',start=await index.rank({root},prefix),end=await index.rank({root},prefix+'\uffff');let previous=null,positive=null;
   for(let offset=start;offset<end;offset+=32)await this.blocks.readSnapshot(async()=>{
   for(let at=offset;at<Math.min(end,offset+32);at++){this.blocks.check();const entry=await index.entryAt({root},at),member=await this.tree.read(entry.revision),present=await this.presentation.find('series',member.seriesId);if(!present)fail();const presentation=await this.tree.read(present.revision),visible=await this.tree.selected(presentation.body,['style','visible']);if(visible.found&&visible.value===false)continue;const value=await this.tree.read(member.body),x=xValue(value.x,plot.header.x.kind);if(previous!==null&&x>previous)plot.domains.minimumXGap=plot.domains.minimumXGap===null?x-previous:Math.min(plot.domains.minimumXGap,x-previous);previous=x;if(x>0){if(positive!==null&&x>positive){const gap=Math.log(x)-Math.log(positive);plot.domains.minimumLogXGap=plot.domains.minimumLogXGap===null?gap:Math.min(plot.domains.minimumLogXGap,gap);}positive=x;}}
   });
  }
  const annotations=this.presentation.collection('annotations'),aRoot=this.presentation.indexesFor('annotations').plots,aStart=await this.presentation.index.rank({root:aRoot},plot.id+':'),aEnd=await this.presentation.index.rank({root:aRoot},plot.id+':\uffff');
  for(let at=aStart;!this.draft&&at<aEnd;at++){
   const entry=await this.presentation.index.entryAt({root:aRoot},at),member=await this.tree.read(entry.revision),annotation=figureValidationValue(await this.owner.bounded(member.body,member.texts));let check=annotation,series=[];
   if(annotation.kind==='callout'){const selected=await this.data.index.find({root:this.data.indexesFor('points').series},annotation.seriesId+':'+ordinal(annotation.pointIndex));if(!selected)invalid();const point=await this.tree.read(selected.revision);if(point.plotId!==plot.id)invalid();series=[{id:annotation.seriesId,points:[figureValidationValue(await this.owner.bounded(point.body,point.texts))]}];check={...annotation,pointIndex:0};}
   if(annotationIssues({...plot.header,series,annotations:[check]},xValue,{retained:true}).length)invalid();
  }
  void annotations;
  await this.data.add('plots',{id:plot.id,plotId:plot.id,body:{series:plot.series,points:plot.points,xKind:plot.header.x.kind}});
  let body={plotId:plot.id,label:plot.label,header:plot.header,slots:plot.slots,domains:plot.domains},bodyRoot=null,texts=null;
  if(plot.retained){bodyRoot=await this.tree.retain(body);const edit=new RecordDocument(this.blocks,bodyRoot,{mutable:true});for(const key of ['header','label']){const selected=await this.tree.select(plot.retained.root,[key]);bodyRoot=await edit.replaceReference(bodyRoot,[key],selected.inline?await this.tree.retain(selected.value):selected.revision);}texts={...plot.retained.texts};}
  await this.presentation.add('panels',{id:plot.panelId,plotId:plot.id,body,bodyRoot,texts});this.plot=null;
 }
 async finish(){
  if(this.done)throw new AppError('INVALID');await this.finishPlot();this.done=true;
  const data=await this.data.manifests(),dataRoot=await this.tree.retain({format:'figure-data',version:1,collections:data.collections});
  const presentation=await this.presentation.manifests(),header=this.retained?.root??await this.tree.retain(this.header),presentationRoot=await this.tree.retain({format:'figure-presentation',version:1,data:dataRoot,header,headerTexts:this.retained?.texts??lengths(this.header),collections:presentation.collections});
  const count=name=>(name==='points'?data.collections:presentation.collections)[name]?.count??0;
  const document={format:this.draft?'figure-authoring':'figure-document',version:1,data:{root:dataRoot,index:data.index},presentation:{root:presentationRoot,index:presentation.index},counts:Object.fromEntries(['panels','series','points','annotations','ticks'].map(name=>[name,count(name)]))};
  if(!validRetainedFigureDocument(document,{draft:this.draft}))throw new AppError('MATERIAL_INVALID');await this.blocks.flush();const figure={id:this.header.id,title:this.header.title.length>1024?{format:'figure-text',version:1,preview:this.header.title.slice(0,512),characters:this.header.title.length}:this.header.title,kind:'retained',version:1,document,...(this.source?{source:this.source}:{})};
  figure.title=(await this.owner.bounded(header,this.retained?.texts??lengths(this.header))).title;
  if(!this.draft&&this.header.kind==='panels')await (await this.owner.open(figure)).validateLinkedAxes();return figure;
 }
}
export class RetainedFigureDocuments{
 constructor(workspace,options={}){this.blocks=new RetainedFigureBlocks(workspace,options);}
 builder(header,options){return new RetainedFigureBuilder(this,header,options);}
 async bounded(root,texts){return new RetainedFigureReader(this.blocks,null,null).bounded(root,texts);}
 async retain(figure){
  if(figureIssues(figure,{retained:true}).length)throw new AppError('MATERIAL_INVALID');const builder=this.builder(figure),plots=figure.kind==='panels'?figure.panels:[{id:figure.id,label:figure.title,figure}];
  for(const panel of plots){await builder.addPlot(panel.figure,{id:panel.id,label:panel.label});for(const series of panel.figure.series){await builder.addSeries(series);for(const point of series.points)await builder.addPoint(point);}}
  return builder.finish();
 }
 async open(value,{draft=false}={}){const figure=value?.document?value:null,document=figure?.document??value;if(figure&&!validRetainedFigure(figure,{draft})||!validRetainedFigureDocument(document,{draft}))throw new AppError('MATERIAL_INVALID');const reader=new RetainedFigureReader(this.blocks,document,figure);await reader.load();return reader;}
}
export class RetainedFigureReader{
 constructor(blocks,document,figure){this.storage=blocks;this.tree=blocks.tree();this.index=new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});this.document=structuredClone(document);this.figure=figure;this.categoryCache=new Map();}
 async load(){
  this.data=await this.tree.read(this.document.data.root);this.presentation=await this.tree.read(this.document.presentation.root);this.dataIndex=await this.tree.read(this.document.data.index);this.presentationIndex=await this.tree.read(this.document.presentation.index);
  if(this.data?.format!=='figure-data'||this.data.version!==1||this.presentation?.format!=='figure-presentation'||this.presentation.version!==1||this.presentation.data!==this.document.data.root||[this.dataIndex,this.presentationIndex].some(value=>value?.format!=='figure-index'||value.version!==1))fail();
  for(const [body,indices] of [[this.data,this.dataIndex],[this.presentation,this.presentationIndex]])for(const [name,collection] of Object.entries(body.collections??{})){
   const index=indices.collections?.[name];if(!collection||!Number.isSafeInteger(collection.count)||collection.count<0||!validTableRef(collection.root)||(collection.root?.count??0)!==collection.count||!index||Object.values(index).some(ref=>!validTableRef(ref))||(index.keys?.count??0)!==collection.count)fail();
  }
  for(const [name,count] of Object.entries(this.document.counts))if((this.collection(name).collection.count)!==count)fail();
 }
 collection(name){const data=name==='points'||name==='plots',body=data?this.data:this.presentation,indices=data?this.dataIndex:this.presentationIndex;return {collection:body.collections[name]??{count:0,root:null},indexes:indices.collections[name]??{keys:null,plots:null,series:null,lookup:null,coordinates:null}};}
 async scope(selection){
  const {collection,indexes}=this.collection(selection.collection);let root=collection.root,start=0,total=collection.count;
  const id=selection.seriesId??selection.plotId;if(id){root=selection.seriesId?indexes.series:indexes.plots;const prefix=id+':';start=await this.index.rank({root},prefix);total=await this.index.rank({root},prefix+'\uffff')-start;}return {root,start,total};
 }
 async member(revision,collection){const item=await this.tree.read(revision);if(!researchId(item?.id)||item.plotId!==null&&!researchId(item.plotId)||item.seriesId!==null&&!researchId(item.seriesId)||item.categoryId!==undefined&&!researchId(item.categoryId)||item.visiblePosition!==undefined&&(!Number.isSafeInteger(item.visiblePosition)||item.visiblePosition<0)||item?.format!=='figure-member'||item.version!==1||item.collection!==collection||!Number.isSafeInteger(item.position)||item.position<0||!Number.isSafeInteger(item.ordinal)||item.ordinal<0)fail();return item;}
 async bounded(revision,texts,path=''){
  const node=await this.tree.node(revision);
  const clip=(value,at)=>{if(typeof value==='string'&&value.length>1024)return {format:'figure-text',version:1,preview:value.slice(0,512),characters:value.length};if(Array.isArray(value))return value.map((child,i)=>clip(child,at?at+'.'+i:String(i)));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,clip(child,at?at+'.'+key:key)]));return value;};
  if(node.type==='inline')return clip(node.value,path);
  if(node.type==='string'){
   const total=texts?.[path];if(!Number.isSafeInteger(total)||total<0)fail();
   // Splices retain string nodes even when their result is short. The wire
   // representation depends on logical length, not the backing node codec.
   if(total<=1024){let value='';for await(const text of this.tree.text(revision,[],{signal:this.storage.signal})){if(value.length+text.length>total)fail();value+=text;}if(value.length!==total)fail();return value;}
   let preview='';for await(const text of this.tree.text(revision,[],{signal:this.storage.signal})){preview+=text.slice(0,512-preview.length);if(preview.length===512)break;}if(preview.length!==512)fail();return {format:'figure-text',version:1,preview,characters:total};
  }
  if(node.type==='object'){const result={};for await(const property of this.tree.children(node)){if(property.type!=='property')fail();result[property.name]=await this.bounded(property.value,texts,path?path+'.'+property.name:property.name);}return result;}
  if(node.type==='array'){const result=[];for await(const child of this.tree.children(node)){if(child.type!=='item')fail();result.push(await this.bounded(child.value,texts,path?path+'.'+result.length:String(result.length)));if(result.length>128)fail();}return result;}fail();
 }
 async expose(item){const {format,version,collection,ordinal,body,texts,...result}=item;result.value=await this.bounded(body,texts);if(collection==='points')result.globalOrdinal=ordinal;if(collection==='series'){const {root,start,total}=await this.scope({collection:'points',seriesId:item.id});void root;void start;result.points=total;}if(collection==='points'&&item.categoryId){result.categoryPosition=await this.categoryPosition({plotId:item.plotId,categoryId:item.categoryId});}return result;}
 async header({plotId}={}){
  if(plotId){const scope=await this.scope({collection:'panels',plotId});if(scope.total!==1)fail();const entry=await this.index.entryAt({root:scope.root},scope.start),member=await this.member(entry.revision,'panels'),body=await this.bounded(member.body,member.texts);const title=this.figure&&(await this.tree.selected(this.presentation.header,['kind'])).value!=='panels'?this.figure.title:body.header.title;return {header:{...body.header,title,plotId},counts:{...this.document.counts,series:(await this.scope({collection:'series',plotId})).total,points:(await this.scope({collection:'points',plotId})).total},document:this.document,domains:body.domains};}
  const header=await this.bounded(this.presentation.header,this.presentation.headerTexts);if(this.figure?.source)header.source=structuredClone(this.figure.source);if(header.kind!=='panels'){const panels=await this.window({collection:'panels',limit:1});if(!panels.items.length&&this.document.format==='figure-authoring')return {header,counts:this.document.counts,document:this.document};if(panels.items.length!==1)fail();const result=await this.header({plotId:panels.items[0].plotId});if(this.figure?.source)result.header.source=structuredClone(this.figure.source);if(this.figure){result.header.id=this.figure.id;result.header.title=this.figure.title;}return result;}if(this.figure){header.id=this.figure.id;header.title=this.figure.title;}return {header,counts:this.document.counts,document:this.document};
 }
 async window(selection){
  if(!validRetainedFigureWindow(selection))throw new AppError('INVALID');const {offset=0,limit=16}=selection,scope=await this.scope(selection);if(offset>scope.total)throw new AppError('INVALID');const items=[];
  for(let at=offset;at<Math.min(offset+limit,scope.total);at++){this.storage.check();const entry=await this.index.entryAt({root:scope.root},scope.start+at);if(!entry)fail();const item=await this.member(entry.revision,selection.collection);if(selection.plotId&&item.plotId!==selection.plotId||selection.seriesId&&item.seriesId!==selection.seriesId)fail();items.push(await this.expose(item));}
  return {items,offset,total:scope.total,next:offset+items.length<scope.total?offset+items.length:null};
 }
 async item(selection){if(!validRetainedFigureItem(selection))throw new AppError('INVALID');const entry=await this.index.find({root:this.collection(selection.collection).indexes.keys},selection.id);if(!entry)return null;const item=await this.member(entry.revision,selection.collection);if(selection.plotId&&item.plotId!==selection.plotId||selection.seriesId&&item.seriesId!==selection.seriesId)return null;return this.expose(item);}
 async *items(selection){let offset=selection.offset??0;for(;;){const page=await this.window({...selection,offset,limit:RETAINED_FIGURE_WINDOW});yield* page.items;if(page.next===null)return;offset=page.next;}}
 async rawPoint({id,offset,seriesId}={}){
  let entry;if(id)entry=await this.index.find({root:this.collection('points').indexes.keys},id);else if(Number.isSafeInteger(offset)&&offset>=0)entry=await this.index.entryAt({root:this.collection('points').collection.root},offset);else throw new AppError('INVALID');
  if(!entry)throw new AppError('INVALID');const member=await this.member(entry.revision,'points');if(seriesId&&member.seriesId!==seriesId)throw new AppError('INVALID');return {member,value:await this.tree.read(member.body)};
 }
 async *pointEntries(selection={}){yield* this.items({collection:'points',...selection});}
 async categories(selection){return this.window({collection:'categories',...selection});}
 async categoryPosition({plotId,value,categoryId}){
  const key=plotId+':'+(categoryId??digest(serialize(value)));if(this.categoryCache.has(key))return this.categoryCache.get(key);
  const root=categoryId?this.collection('categories').indexes.keys:this.collection('categories').indexes.lookup,entry=await this.index.find({root},categoryId??key);if(!entry)return null;
  const item=await this.member(entry.revision,'categories');if(item.plotId!==plotId)throw new AppError('INVALID');if(!categoryId&&(await this.tree.read(item.body))!==value)fail();
  if(this.categoryCache.size>=128)this.categoryCache.delete(this.categoryCache.keys().next().value);this.categoryCache.set(key,item.position);return item.position;
 }
 async pointAtCategory({plotId,seriesId,value,categoryId}){
  if(categoryId&&await this.categoryPosition({plotId,categoryId})===null)return null;const entry=await this.index.find({root:this.collection('points').indexes.lookup},plotId+':'+seriesId+':'+(categoryId??identity(plotId,value)));if(!entry)return null;
  const item=await this.member(entry.revision,'points');if(item.plotId!==plotId||item.seriesId!==seriesId||categoryId&&item.categoryId!==categoryId)fail();if(!categoryId&&(await this.tree.selected(item.body,['x'])).value!==value)fail();return this.expose(item);
 }

 async cells(selection){
  if(!selection||Object.keys(selection).some(key=>!['plotId','seriesId','offset','limit'].includes(key))||!researchId(selection.plotId)||!researchId(selection.seriesId))throw new AppError('INVALID');
  const series=await this.item({collection:'series',id:selection.seriesId,plotId:selection.plotId});if(!series)throw new AppError('INVALID');
  const {seriesId,...scope}=selection,page=await this.window({collection:'categories',...scope}),items=[];
  for(const category of page.items){this.storage.check();items.push({category,point:await this.pointAtCategory({plotId:selection.plotId,seriesId,categoryId:category.id})});}
  return {...page,items};
 }

 async textTarget({collection,id,plotId,seriesId,field}){
  if(collection==='header'){if(plotId||id!==this.figure?.id&&id!==(await this.tree.selected(this.presentation.header,['id'])).value){const scope=await this.scope({collection:'panels',plotId:plotId??id});if(scope.total!==1)throw new AppError('INVALID');const entry=await this.index.entryAt({root:scope.root},scope.start),member=await this.member(entry.revision,'panels');return {root:member.body,path:['header',...field.split('.')],total:member.texts['header.'+field]};}return {root:this.presentation.header,path:field.split('.'),total:this.presentation.headerTexts[field]};}
  const entry=await this.index.find({root:this.collection(collection).indexes.keys},id);if(!entry)throw new AppError('INVALID');const member=await this.member(entry.revision,collection);if(collection==='categories'&&field==='value')field='';if(plotId&&member.plotId!==plotId||seriesId&&member.seriesId!==seriesId)throw new AppError('INVALID');return {root:member.body,path:field?field.split('.'):[],total:member.texts[field]};
 }
 async *textChunks(selection){const target=await this.textTarget(selection);if(!Number.isSafeInteger(target.total))throw new AppError('INVALID');yield* this.tree.text(target.root,target.path,{signal:this.storage.signal});}
 async text(selection){const {offset=0,limit=16384}=selection;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16384)throw new AppError('INVALID');const target=await this.textTarget(selection);if(!Number.isSafeInteger(target.total)||offset>target.total)throw new AppError('INVALID');let skipped=0,text='';for await(const chunk of this.tree.text(target.root,target.path,{signal:this.storage.signal})){const from=Math.max(0,offset-skipped);text+=chunk.slice(from,from+limit-text.length);skipped+=chunk.length;if(text.length===limit||skipped>=target.total)break;}return {text,offset,total:target.total,next:offset+text.length<target.total?offset+text.length:null};}
 async *valueJSON(root,path=[]){const target=await this.tree.select(root,path);if(!target)fail();if(target.inline)yield JSON.stringify(target.value);else yield* this.tree.json(target.revision,{canonical:false,signal:this.storage.signal});}
 async *memberRows(selection){const scope=await this.scope(selection);for(let at=0;at<scope.total;at++){this.storage.check();const entry=await this.index.entryAt({root:scope.root},scope.start+at);if(!entry)fail();yield await this.member(entry.revision,selection.collection);}}
 async *jsonObject(root,{path=[],skip=[],extra=[]}={}){
  const target=await this.tree.select(root,path);if(!target)fail();const names=target.inline?Object.keys(target.value):await this.tree.propertyNames(target.revision);yield '{';let count=0;
  for(const name of names){if(skip.includes(name))continue;if(count++)yield ',';yield JSON.stringify(name)+':';yield* this.valueJSON(root,[...path,name]);}
  for(const [name,parts] of extra){if(count++)yield ',';yield JSON.stringify(name)+':';yield* parts;}yield '}';
 }
 async *jsonArray(selection,render){yield '[';let count=0;for await(const member of this.memberRows(selection)){if(count++)yield ',';yield* render(member);}yield ']';}
 async panelMember(plotId){const scope=await this.scope({collection:'panels',plotId});if(scope.total!==1)fail();const entry=await this.index.entryAt({root:scope.root},scope.start);return this.member(entry.revision,'panels');}
 wrapperJSON(){
  if(!this.figure)return [];
  return [['id',[JSON.stringify(this.figure.id)]],['title',typeof this.figure.title==='string'?[JSON.stringify(this.figure.title)]:this.valueJSON(this.presentation.header,['title'])],...(this.figure.source?[['source',[JSON.stringify(this.figure.source)]]]:[])];
 }
 async *plotJSON(plotId,{wrapper=false}={}){
  if(this.document.format!=='figure-document')throw new AppError('MATERIAL_INVALID');
  const panel=await this.panelMember(plotId),slots=(await this.tree.selected(panel.body,['slots'])).value,owner=this,extra=[];
  for(const axis of ['x','y']){const parts=async function*(){const ticks=async function*(){yield '[';let count=0;for await(const member of owner.memberRows({collection:'ticks',plotId})){if((await owner.tree.selected(member.body,['axis'])).value!==axis)continue;if(count++)yield ',';yield* owner.jsonObject(member.body,{skip:['axis']});}yield ']';};yield* owner.jsonObject(panel.body,{path:['header',axis],extra:slots[axis+'Ticks']?[['ticks',ticks()]]:[]});};extra.push([axis,parts()]);}
  const series=async function*(){yield* owner.jsonArray({collection:'series',plotId},member=>owner.jsonObject(member.body,{extra:[['points',owner.jsonArray({collection:'points',plotId,seriesId:member.id},point=>owner.jsonObject(point.body,{skip:['source']}))]]}));};extra.push(['series',series()]);
  if(slots.annotations)extra.push(['annotations',this.jsonArray({collection:'annotations',plotId},member=>this.valueJSON(member.body))]);
  yield* this.jsonObject(panel.body,{path:['header'],skip:['x','y',...(wrapper&&this.figure?['id','title','source']:[])],extra:[...extra,...(wrapper?this.wrapperJSON():[])]});
 }
 async *json(){
  if(this.document.format!=='figure-document')throw new AppError('MATERIAL_INVALID');
  const kind=(await this.tree.selected(this.presentation.header,['kind'])).value;
  if(kind!=='panels'){const first=await this.window({collection:'panels',limit:1});yield* this.plotJSON(first.items[0].plotId,{wrapper:true});return;}
  const owner=this,panels=async function*(){yield '[';let count=0;for await(const member of owner.memberRows({collection:'panels'})){if(count++)yield ',';yield '{"id":'+JSON.stringify(member.id)+',"label":';yield* owner.valueJSON(member.body,['label']);yield ',"figure":';yield* owner.plotJSON(member.plotId);yield '}';}yield ']';};
  yield* this.jsonObject(this.presentation.header,{skip:this.figure?['id','title','source']:[],extra:[['panels',panels()],...this.wrapperJSON()]});
 }
 // Linked axes compare complete labels and sorted tick identities without
 // retaining a panel list or materializing its potentially long text.
 async validateLinkedAxes({signal=this.storage.signal}={}){
  const root=await this.bounded(this.presentation.header,this.presentation.headerTexts);if(root.kind!=='panels')return;
  const first={};
  const textHash=async(root,path)=>{const hash=createHash('sha256');for await(const text of recordTextJSON(this.tree.text(root,path,{signal}),{signal}))hash.update(text);return hash.digest('hex');};
  for await(const panel of this.memberRows({collection:'panels'})){
   signal?.throwIfAborted();const body=await this.bounded(panel.body,panel.texts),header=body.header;
   for(const axis of ['x','y'])if(root.layout[axis==='x'?'linkX':'linkY']){
    if(header.kind==='heatmap'||axis==='x'&&header.x.kind==='category')invalid();
    const label=await textHash(panel.body,['header',axis,'label']),hash=createHash('sha256'),index=this.presentationIndex.collections.ticks?.lookup,prefix=panel.plotId+':'+axis+':',start=await this.index.rank({root:index},prefix),end=await this.index.rank({root:index},prefix+'\uffff');
    for(let at=start;at<end;at++){
     signal?.throwIfAborted();const entry=await this.index.entryAt({root:index},at),member=await this.member(entry.revision,'ticks'),value=(await this.tree.selected(member.body,['value'])).value;
     if(member.plotId!==panel.plotId||(await this.tree.selected(member.body,['axis'])).value!==axis)fail();
     hash.update(JSON.stringify(value)+':'+await textHash(member.body,['label'])+';');
    }
    const signature=revisionText({kind:header[axis].kind??null,scale:header[axis].scale,reversed:!!header[axis].reversed,horizontal:header.kind==='bar-horizontal',label,ticks:hash.digest('hex'),tickCount:end-start});
    if(first[axis]){if(signature!==first[axis].signature||!sameAxisProjection(header,first[axis].header,axis))invalid();}else first[axis]={signature,header};
   }
  }
 }
 async verify({signal=this.storage.signal}={}){
  const same=(a,b)=>revisionText(a)===revisionText(b),check=()=>signal?.throwIfAborted();
  const rootHeader=await this.tree.read(this.presentation.header);validateHeader(rootHeader);await this.validateLinkedAxes({signal});
  const allowedData=['plots','series','points'],allowedPresentation=['panels','series','annotations','ticks','categories'];
  if(!same(this.presentation.headerTexts,lengths(rootHeader))||rootHeader.kind!=='panels'&&this.document.counts.panels!==1||rootHeader.kind==='panels'&&this.document.counts.panels<2)fail();
  for(const [body,indices,allowed,data]of [[this.data,this.dataIndex,allowedData,true],[this.presentation,this.presentationIndex,allowedPresentation,false]]){
   if(Object.keys(body.collections).some(name=>!allowed.includes(name))||Object.keys(indices.collections).sort().join()!==Object.keys(body.collections).sort().join())fail();
   for(const [name,collection]of Object.entries(body.collections)){
    check();const indexes=indices.collections[name];if(Object.keys(indexes).sort().join()!=='coordinates,keys,lookup,plots,series')fail();
    for(const ref of [collection.root,...Object.values(indexes)])for await(const node of this.index.nodes(ref,{signal}))void node;
    let count=0,plotCount=0,seriesCount=0,coordinateCount=0,lookupCount=0;
    const expected=async(member,slot,value)=>{
     if(slot==='keys')return member.id;if(slot==='plots')return member.plotId?member.plotId+':'+ordinal(member.ordinal):null;
     if(slot==='series')return member.seriesId?member.seriesId+':'+ordinal(member.position):null;
     if(slot==='coordinates'){if(name!=='points')return null;const panel=await this.panelMember(member.plotId),kind=(await this.tree.selected(panel.body,['header','x','kind'])).value,x=xValue(value.x,kind);return typeof x==='number'?member.plotId+':'+numericKey(x)+':'+ordinal(member.ordinal):null;}
     if(name==='points')return member.plotId+':'+member.seriesId+':'+member.categoryId;
     if(name==='series'&&!data)return member.plotId+':'+digest(serialize(value.name));
     if(name==='categories')return member.plotId+':'+digest(serialize(value));
     if(name==='ticks')return member.plotId+':'+value.axis+':'+numericKey(value.value);return null;
    };
    for await(const entry of this.index.entries({root:collection.root})){
     check();const member=await this.member(entry.revision,name),value=await this.tree.read(member.body);
     if(entry.id!==ordinal(count)||member.ordinal!==count++||!same(member.texts,lengths(value)))fail();
     for(const slot of Object.keys(indexes)){
      const id=await expected(member,slot,value);if(id===null)continue;
      if(slot==='plots')plotCount++;if(slot==='series')seriesCount++;if(slot==='coordinates')coordinateCount++;if(slot==='lookup')lookupCount++;
      const found=await this.index.find({root:indexes[slot]},id);if(!found)fail();
      if(slot==='lookup'&&name==='points'){const last=await this.member(found.revision,name);if(last.ordinal<member.ordinal||last.categoryId!==member.categoryId||last.seriesId!==member.seriesId)fail();}else if(found.revision!==entry.revision)fail();
     }
    }
    if(count!==collection.count||(indexes.plots?.count??0)!==plotCount||(indexes.series?.count??0)!==seriesCount||(indexes.coordinates?.count??0)!==coordinateCount||name!=='points'&&(indexes.lookup?.count??0)!==lookupCount)fail();
    for(const [slot,root]of Object.entries(indexes))for await(const entry of this.index.entries({root})){
     check();const member=await this.member(entry.revision,name),stored=await this.index.find({root:collection.root},ordinal(member.ordinal));if(stored?.revision!==entry.revision||entry.id!==await expected(member,slot,await this.tree.read(member.body)))fail();
    }
   }
  }
  for await(const panel of this.memberRows({collection:'panels'})){
   check();const body=await this.tree.read(panel.body),header=body.header;validateHeader(header);if(header.id!==panel.plotId||!researchId(panel.id)||typeof body.label!=='string'||!body.label.trim()||Object.keys(body.slots??{}).sort().join()!=='annotations,xTicks,yTicks'||Object.values(body.slots).some(value=>typeof value!=='boolean'))fail();
   const domains={x:emptyExtent(),y:emptyExtent(),minimumXGap:null,minimumLogXGap:null,categoryCount:(await this.scope({collection:'categories',plotId:panel.plotId})).total,visibleSeriesCount:0,maximumCategoryLength:0,maximumSeriesNameLength:0};let pointCount=0,seriesCount=0;
   for await(const series of this.memberRows({collection:'series',plotId:panel.plotId})){
    const value=await this.tree.read(series.body);if(figureIssues({...header,series:[{...value,points:[sample(header)]}]},{retained:true}).length||series.position!==seriesCount++)fail();
    const visible=seriesStyle(value).visible;if(visible){if(series.visiblePosition!==domains.visibleSeriesCount++)fail();domains.maximumSeriesNameLength=Math.max(domains.maximumSeriesNameLength,value.name.length);}else if(series.visiblePosition!==undefined)fail();
    const local={x:emptyExtent(),y:emptyExtent()};let count=0,complete=0;
    for await(const member of this.memberRows({collection:'points',plotId:panel.plotId,seriesId:series.id})){
     check();const {source,...point}=await this.tree.read(member.body);if(source&&Object.hasOwn(source,'origin')&&!validAuthoredPointOrigin(source.origin))fail();validateRetainedFigurePoint(point,header);if(member.plotId!==panel.plotId||member.position!==count++||member.categoryId!==identity(panel.plotId,point.x))fail();if(point.y!==null)complete++;
     const intervals=pointIntervals(point);for(const x of intervals.x){extent(local.x,xValue(x,header.x.kind));if(visible)extent(domains.x,xValue(x,header.x.kind));}if(point.y!==null)for(const y of intervals.y){extent(local.y,y);if(visible)extent(domains.y,y);}
     if(visible&&header.x.kind==='category'){if(await this.categoryPosition({plotId:panel.plotId,categoryId:member.categoryId})===null)fail();domains.maximumCategoryLength=Math.max(domains.maximumCategoryLength,point.x.length);}
    }
    if(!complete&&header.kind!=='heatmap')fail();pointCount+=count;const data=await this.index.find({root:this.dataIndex.collections.series.keys},series.id);if(!data)fail();const member=await this.member(data.revision,'series'),stored=await this.tree.read(member.body);if(member.plotId!==panel.plotId||!same(stored,{points:count,domains:local}))fail();
   }
   for await(const tick of this.memberRows({collection:'ticks',plotId:panel.plotId})){const value=await this.tree.read(tick.body);if(!['x','y'].includes(value.axis)||axisControlIssues({...header[value.axis],ticks:[{value:value.value,label:value.label}]},{kind:header[value.axis].kind??'number',retained:true}).length)fail();extent(domains[value.axis],value.value);}
   const coordinateRoot=this.dataIndex.collections.points?.coordinates,prefix=panel.plotId+':',start=await this.index.rank({root:coordinateRoot},prefix),end=await this.index.rank({root:coordinateRoot},prefix+'\uffff');let previous=null,positive=null;
   for(let at=start;at<end;at++){check();const entry=await this.index.entryAt({root:coordinateRoot},at),point=await this.member(entry.revision,'points'),series=await this.item({collection:'series',id:point.seriesId});if(!seriesStyle(series.value).visible)continue;const x=xValue((await this.tree.selected(point.body,['x'])).value,header.x.kind);if(previous!==null&&x>previous)domains.minimumXGap=domains.minimumXGap===null?x-previous:Math.min(domains.minimumXGap,x-previous);previous=x;if(x>0){if(positive!==null&&x>positive){const gap=Math.log(x)-Math.log(positive);domains.minimumLogXGap=domains.minimumLogXGap===null?gap:Math.min(domains.minimumLogXGap,gap);}positive=x;}}
   if(!same(domains,body.domains))fail();const plot=await this.index.find({root:this.dataIndex.collections.plots.keys},panel.plotId),stored=plot&&await this.member(plot.revision,'plots');if(!stored||!same(await this.tree.read(stored.body),{series:seriesCount,points:pointCount,xKind:header.x.kind}))fail();
   for await(const member of this.memberRows({collection:'annotations',plotId:panel.plotId})){
    const annotation=await this.tree.read(member.body);let value=annotation,series=[];if(annotation.kind==='callout'){const entry=await this.index.find({root:this.dataIndex.collections.points.series},annotation.seriesId+':'+ordinal(annotation.pointIndex));if(!entry)fail();const point=await this.member(entry.revision,'points');if(point.plotId!==panel.plotId)fail();series=[{id:annotation.seriesId,points:[await this.tree.read(point.body)]}];value={...annotation,pointIndex:0};}if(annotationIssues({...header,series,annotations:[value]},xValue,{retained:true}).length)fail();
   }
  }
  for await(const block of this.blocks({signal})){if(block.kind==='value')await this.tree.node(block.revision);}
  return {...this.document.counts};
 }
 async *blocks(options={}){yield* this.storage.closure([this.document.data.root,this.document.data.index,this.document.presentation.root,this.document.presentation.index],options);}
}
