// A selected presentation edit retains the immutable plotted data verbatim.
// Text splices stream through the existing counted JSON string representation.
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {RecordDocument} from './record-document.js';
import {RecordSequenceBuilder} from './record-tree-values.js';
import {recordTextJSON} from './record-string-stream.js';
import {RetainedFigureDocuments,validateRetainedFigurePoint} from './retained-figure-document.js';
import {validRetainedFigureOperation} from './web/retained-figure-presentation-model.js';
import {figureIssues,xValue} from './web/figure-model.js';
import {seriesStyle} from './web/figure-style.js';
import {annotationIssues} from './web/figure-annotations.js';
import {axisControlIssues} from './web/figure-axis-controls.js';
import {researchId} from './web/research-reference.js';
import {validMaterialReference} from './web/material-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {validRetainedFigure} from './web/retained-figure-model.js';
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const ordinal=value=>String(value).padStart(16,'0');
const emptyExtent=()=>({min:null,max:null,positiveMin:null,positiveMax:null});
const extent=(target,value)=>{if(typeof value!=='number'||!Number.isFinite(value))return;target.min=target.min===null?value:Math.min(target.min,value);target.max=target.max===null?value:Math.max(target.max,value);if(value>0){target.positiveMin=target.positiveMin===null?value:Math.min(target.positiveMin,value);target.positiveMax=target.positiveMax===null?value:Math.max(target.positiveMax,value);}};
const numericKey=value=>{const bytes=Buffer.alloc(8);bytes.writeDoubleBE(Object.is(value,-0)?0:value);if(bytes[0]&128)for(let i=0;i<8;i++)bytes[i]^=255;else bytes[0]^=128;return bytes.toString('hex');};
const stringFields={header:['title','x.label','y.label','markerArea.label','heatmap.valueLabel'],panels:['label'],series:['name'],annotations:['label'],ticks:['label']};
const fields={header:['title','legend','style','x','y','heatmap','markerArea','layout'],panels:['label'],series:['name','color','style'],annotations:['kind','axis','start','end','label','color','opacity','xLower','xUpper','yLower','yUpper','seriesId','pointIndex','dx','dy'],ticks:['axis','value','label']};
const substitute=value=>value?.format==='figure-text'?'Retained text':Array.isArray(value)?value.map(substitute):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,substitute(item)])):value;
const lengths=(value,path='',result={})=>{if(typeof value==='string')result[path]=value.length;else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))lengths(child,path?path+'.'+key:key,result);return result;};
const emptyIndexes=()=>({keys:null,plots:null,series:null,lookup:null,coordinates:null});
async function stringHash(tree,root,path){const hash=createHash('sha256');for await(const text of recordTextJSON(tree.text(root,path)))hash.update(text);return hash.update('\n').digest('hex');}
async function retainedText(blocks,chunks,{signal}={}){
 const builder=new RecordSequenceBuilder(blocks);let bytes=0,pending=Buffer.alloc(32768),used=0;
 async function append(buffer){let offset=0;while(offset<buffer.length){signal?.throwIfAborted();const length=Math.min(pending.length-used,buffer.length-offset);buffer.copy(pending,used,offset,offset+length);offset+=length;used+=length;bytes+=length;if(used===pending.length){await builder.addNode({type:'bytes',value:pending.toString('base64')});pending=Buffer.alloc(32768);used=0;}}}
 for await(const text of recordTextJSON(chunks,{signal}))await append(Buffer.from(text));await append(Buffer.from('\n'));if(used)await builder.addNode({type:'bytes',value:pending.subarray(0,used).toString('base64')});
 return blocks.put('value',{type:'string',root:await builder.finishIndex(),bytes});
}
export async function spliceFigureText(blocks,root,path,total,{offset,remove,text},{required=false,annotation=false,signal}={}){
 if(!Number.isSafeInteger(total)||offset>total||remove>total-offset||!Number.isSafeInteger(total-remove+text.length))invalid();
 let at=0,inserted=false,nonblank=false;
 async function* chunks(){
  const check=value=>{if((annotation?/[\u0000-\u001f]/u:/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u).test(value))invalid();if(value.trim())nonblank=true;return value;};
  for await(const chunk of blocks.tree().text(root,path,{signal})){
   const end=at+chunk.length;
   if(at<offset)yield check(chunk.slice(0,Math.min(chunk.length,offset-at)));
   if(!inserted&&end>=offset){inserted=true;yield check(text);}
   if(end>offset+remove)yield check(chunk.slice(Math.max(0,offset+remove-at)));
   at=end;
  }
  if(at!==total)throw new AppError('MATERIAL_MISSING');if(!inserted){inserted=true;yield check(text);}if(required&&!nonblank)invalid();
 }
 return {root:await retainedText(blocks,chunks(),{signal}),total:total-remove+text.length};
}
export class RetainedFigurePresentation{
 constructor(documents,reader,{signal}={}){this.documents=documents;this.reader=reader;this.blocks=documents.blocks;this.tree=this.blocks.tree();this.index=new RetainedTableIndex(this.blocks,{namespace:'index',allowSparseBranches:true});this.signal=signal;this.changedPlots=new Set();this.rebuildCategories=false;}
 async initialize(){this.reader.storage=this.blocks;this.reader.tree=this.tree;this.reader.index=this.index;this.reader.presentation=structuredClone(this.reader.presentation);this.reader.presentationIndex=structuredClone(this.reader.presentationIndex);this.reader.document=structuredClone(this.reader.document);return this;}
 check(){this.signal?.throwIfAborted();}
 async member(collection,id,plotId){const entry=await this.index.find({root:this.reader.collection(collection).indexes.keys},id);if(!entry)invalid();const member=await this.reader.member(entry.revision,collection);if(plotId&&member.plotId!==plotId)invalid();return member;}
 async lookup(member){
  if(member.collection==='series')return member.plotId+':'+await stringHash(this.tree,member.body,['name']);
  if(member.collection==='ticks'){const value=await this.tree.read(member.body);return member.plotId+':'+value.axis+':'+numericKey(value.value);}
  if(member.collection==='categories')return member.plotId+':'+await stringHash(this.tree,member.body,[]);return null;
 }
 async checkpoint(){const roots=[...Object.values(this.reader.presentation.collections).map(row=>row.root),...Object.values(this.reader.presentationIndex.collections).flatMap(row=>Object.values(row))];await this.index.flushRoots(roots);}
 async setMember(member,old=null){
  const collection=this.reader.presentation.collections[member.collection]??={count:0,root:null},indexes=this.reader.presentationIndex.collections[member.collection]??=emptyIndexes(),lookup=await this.lookup(member);
  if(lookup!==null){const found=await this.index.find({root:indexes.lookup},lookup);if(found){const prior=await this.reader.member(found.revision,member.collection);if(prior.id!==member.id)invalid();}}
  if(old){const previous=await this.lookup(old);if(previous!==null&&previous!==lookup)indexes.lookup=await this.index.remove(indexes.lookup,previous);}
  const revision=await this.tree.retain(member);collection.root=await this.index.change(collection.root,ordinal(member.ordinal),revision);indexes.keys=await this.index.change(indexes.keys,member.id,revision);
  if(member.plotId)indexes.plots=await this.index.change(indexes.plots,member.plotId+':'+ordinal(member.ordinal),revision);
  if(member.seriesId)indexes.series=await this.index.change(indexes.series,member.seriesId+':'+ordinal(member.position),revision);
  if(lookup!==null)indexes.lookup=await this.index.change(indexes.lookup,lookup,revision);
  if(this.index.pending.size>=128||this.index.pendingBytes>=262144)await this.checkpoint();return member;
 }
 async property(root,path,name,value){return (await new RecordDocument(this.blocks,root,{mutable:true}).property(path,name,value,{signal:this.signal})).root;}
 async target(operation){
  if(operation.collection==='header'){
   const headerKind=(await this.tree.selected(this.reader.presentation.header,['kind'])).value;
   if(operation.plotId||headerKind!=='panels'){const panel=operation.plotId?await this.reader.panelMember(operation.plotId):await this.reader.panelMember((await this.tree.selected(this.reader.presentation.header,['id'])).value);return {member:panel,root:panel.body,path:['header'],texts:panel.texts,global:headerKind!=='panels'};}
   if(operation.id&&operation.id!==(await this.tree.selected(this.reader.presentation.header,['id'])).value)invalid();return {member:null,root:this.reader.presentation.header,path:[],texts:this.reader.presentation.headerTexts,global:true};
  }
  const member=await this.member(operation.collection,operation.id,operation.plotId);return {member,root:member.body,path:[],texts:member.texts,global:false};
 }
 async applyPatch(operation,target){
  if(Object.keys(operation.patch).some(key=>!fields[operation.collection].includes(key)))invalid();let root=target.root,texts={...target.texts};
  for(const [key,value]of Object.entries(operation.patch)){
   const path=[...target.path,key],textKey=path.join('.');
   if(typeof value==='string'){if(value.length>16384)invalid();const prior=texts[textKey];if(Number.isSafeInteger(prior)&&prior>16384)invalid();}
   if(['style','x','y','layout','heatmap','markerArea'].includes(key)){
    if(!value||typeof value!=='object'||Array.isArray(value)||key==='heatmap'&&Object.hasOwn(value,'thresholds'))invalid();if(['x','y'].includes(key)&&Object.keys(value).some(name=>!['label','scale','min','max','reversed'].includes(name)))invalid();
    const current=await this.tree.select(root,path);if(!current){root=await this.property(root,target.path,key,{});}
    for(const [name,child]of Object.entries(value)){if(typeof child==='string'&&(child.length>16384||(texts[[...path,name].join('.')]??0)>16384))invalid();root=await this.property(root,path,name,child);}
   }else root=await this.property(root,target.path,key,value);
   for(const name of Object.keys(texts))if(name===textKey||name.startsWith(textKey+'.'))delete texts[name];
   // Existing unmodified nested text paths remain in place.
   const selected=await this.tree.select(root,path);if(selected){const bounded=await this.reader.bounded(selected.inline?await this.tree.retain(selected.value):selected.revision,target.texts,textKey);const keep=(item,p)=>{if(item?.format==='figure-text'){texts[p]=item.characters;return;}if(typeof item==='string')texts[p]=item.length;else if(item&&typeof item==='object')for(const [name,child]of Object.entries(item))keep(child,p+'.'+name);};keep(bounded,textKey);}
  }
  return {root,texts};
 }
 async applyThreshold(operation,target){
  const path=[...target.path,'heatmap','thresholds',String(operation.index)];if(!await this.tree.select(target.root,path))invalid();let root=target.root;
  for(const [name,value]of Object.entries(operation.patch)){
   if(name==='max'&&value!==null&&!Number.isFinite(value)||name==='color'&&(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value)))invalid();
   root=await this.property(root,path,name,value);
  }
  return {root,texts:{...target.texts}};
 }
 async validateMember(member){
  const value=substitute(await this.reader.bounded(member.body,member.texts));
  if(member.collection==='panels'){
   const header=value.header;if(typeof value.label!=='string'||!value.label.trim())invalid();await this.validateHeader(header,member.plotId);return;
  }
  if(member.collection==='categories')return;
  const {plotId:ignoredPlot,source:ignoredSource,...header}=substitute((await this.reader.header({plotId:member.plotId})).header),point={x:header.x.kind==='number'?1:header.x.kind==='date'?'2000-01-01':'Category',y:1,error:null,...(header.markerArea?{count:1}:{})};
  if(member.collection==='series'){if(figureIssues({...header,series:[{...value,points:[point]}]},{retained:true}).length)invalid();return;}
  if(member.collection==='ticks'){if(header.kind==='heatmap'||!['x','y'].includes(value.axis)||axisControlIssues({...header[value.axis],ticks:[{value:value.value,label:value.label}]},{kind:header[value.axis].kind??'number',retained:true}).length)invalid();return;}
  if(member.collection==='annotations'){
   if(header.kind==='heatmap')invalid();let annotation=value,series=[];if(value.kind==='callout'){const entry=await this.index.find({root:this.reader.dataIndex.collections.points.series},value.seriesId+':'+ordinal(value.pointIndex));if(!entry)invalid();const pointMember=await this.reader.member(entry.revision,'points');if(pointMember.plotId!==member.plotId)invalid();const measured=substitute(await this.reader.bounded(pointMember.body,pointMember.texts));series=[{id:value.seriesId,points:[measured]}];annotation={...value,pointIndex:0};}
   if(annotationIssues({...header,series,annotations:[annotation]},xValue,{retained:true}).length)invalid();
  }
 }
 async validateHeader(header,plotId){
  if(header.kind==='panels'){if(!header.title.trim()||!header.layout||Object.keys(header.layout).sort().join()!=='columns,linkX,linkY'||!Number.isInteger(header.layout.columns)||header.layout.columns<1||header.layout.columns>3||typeof header.layout.linkX!=='boolean'||typeof header.layout.linkY!=='boolean')invalid();return;}
  const point={x:header.x.kind==='number'?1:header.x.kind==='date'?'2000-01-01':'Category',y:1,error:null,...(header.markerArea?{count:1}:{})};if(figureIssues({...header,series:[{id:header.id,name:'Validation',color:'#123456',points:[point]}]},{retained:true}).length)invalid();
  const panel=await this.reader.panelMember(plotId),domains=(await this.tree.selected(panel.body,['domains'])).value;
  for(const axis of ['x','y'])if(header[axis].scale==='log'&&domains[axis].min!==null&&domains[axis].min<=0)invalid();
 }
 async validatePlotConstraints(plotId,{points=false}={}){
  const panel=await this.reader.panelMember(plotId),header=substitute((await this.reader.bounded(panel.body,panel.texts)).header);
  if(points)for await(const member of this.reader.memberRows({collection:'points',plotId})){
   this.check();const {source,...point}=substitute(await this.reader.bounded(member.body,member.texts));void source;validateRetainedFigurePoint(point,header);
  }
  for(const collection of ['ticks','annotations'])for await(const member of this.reader.memberRows({collection,plotId})){
   this.check();if(header.kind==='heatmap')invalid();await this.validateMember(member);
  }
 }
 async rewrite(collection,operation){
  const prior=this.reader.collection(collection),root=prior.collection.root,reader=this.reader,index=this.index,total=prior.collection.count;
  let selected=null,other=null;
  if(operation.type!=='append'){selected=await this.member(collection,operation.id,operation.plotId);if(operation.type==='move'){const scope=await reader.scope({collection,...(collection!=='panels'&&selected.plotId?{plotId:selected.plotId}:{})}),relative=collection==='panels'?selected.ordinal:await index.rank({root:scope.root},selected.plotId+':'+ordinal(selected.ordinal))-scope.start,next=relative+operation.direction;if(next<0||next>=scope.total)return;const found=await index.entryAt({root:scope.root},scope.start+next);other=await reader.member(found.revision,collection);}}
  this.reader.presentation.collections[collection]={count:0,root:null};this.reader.presentationIndex.collections[collection]=emptyIndexes();
  const append=async member=>{const position=collection==='panels'?this.reader.presentation.collections[collection].count:(await this.reader.scope({collection,plotId:member.plotId})).total;const row={...member,ordinal:this.reader.presentation.collections[collection].count++,position};await this.setMember(row);};
  for(let at=0;at<total;at++){this.check();const entry=await index.entryAt({root},at);let member=await reader.member(entry.revision,collection);if(operation.type==='remove'&&member.id===selected.id)continue;if(other){if(member.id===selected.id)member=other;else if(member.id===other.id)member=selected;}await append(member);}
  if(operation.type==='append'){
   const value=structuredClone(operation.value),id=collection==='annotations'?value.id:randomUUID();if(!researchId(id)||collection==='ticks'&&Object.hasOwn(value,'id'))invalid();
   const member={format:'figure-member',version:1,collection,id,plotId:operation.plotId,seriesId:null,position:0,ordinal:0,body:await this.tree.retain(value),texts:lengths(value)};await this.validateMember(member);await append(member);
  }
  if(selected?.plotId)this.changedPlots.add(selected.plotId);if(operation.plotId)this.changedPlots.add(operation.plotId);if(collection==='series')this.rebuildCategories=true;
 }
 async refresh(plotId){
  const panel=await this.reader.panelMember(plotId),body=substitute(await this.reader.bounded(panel.body,panel.texts)),domains={x:emptyExtent(),y:emptyExtent(),minimumXGap:body.domains.minimumXGap,minimumLogXGap:body.domains.minimumLogXGap,categoryCount:body.domains.categoryCount,visibleSeriesCount:0,maximumCategoryLength:body.domains.maximumCategoryLength,maximumSeriesNameLength:0};
  for await(const original of this.reader.memberRows({collection:'series',plotId})){
   const member={...original},style=(await this.tree.selected(member.body,['style'])).value,visible=style?.visible!==false;if(visible){member.visiblePosition=domains.visibleSeriesCount++;domains.maximumSeriesNameLength=Math.max(domains.maximumSeriesNameLength,member.texts.name);const source=await this.index.find({root:this.reader.dataIndex.collections.series.keys},member.id),summary=await this.tree.read((await this.reader.member(source.revision,'series')).body);for(const axis of ['x','y'])for(const value of Object.values(summary.domains[axis]))extent(domains[axis],value);}else delete member.visiblePosition;
   if(member.visiblePosition!==original.visiblePosition)await this.setMember(member,original);
  }
  for await(const tick of this.reader.memberRows({collection:'ticks',plotId})){const value=await this.tree.read(tick.body);extent(domains[value.axis],value.value);}
  if(this.rebuildCategories){
   domains.minimumXGap=null;domains.minimumLogXGap=null;let previous=null,positive=null;
   const root=this.reader.dataIndex.collections.points.coordinates,prefix=plotId+':',start=await this.index.rank({root},prefix),end=await this.index.rank({root},prefix+'\uffff');
   for(let at=start;at<end;at++){this.check();const entry=await this.index.entryAt({root},at),point=await this.reader.member(entry.revision,'points'),series=await this.reader.item({collection:'series',id:point.seriesId});if(!seriesStyle(series.value).visible)continue;const x=xValue((await this.tree.selected(point.body,['x'])).value,body.header.x.kind);if(previous!==null&&x>previous)domains.minimumXGap=domains.minimumXGap===null?x-previous:Math.min(domains.minimumXGap,x-previous);previous=x;if(x>0){if(positive!==null&&x>positive){const gap=Math.log(x)-Math.log(positive);domains.minimumLogXGap=domains.minimumLogXGap===null?gap:Math.min(domains.minimumLogXGap,gap);}positive=x;}}
  }
  let root=await this.property(panel.body,[],'domains',domains);const slots={...(await this.tree.selected(root,['slots'])).value};for(const [collection,slot]of [['annotations','annotations'],['ticks','xTicks'],['ticks','yTicks']])if((await this.reader.scope({collection,plotId})).total)slots[slot]=true;root=await this.property(root,[],'slots',slots);await this.setMember({...panel,body:root},panel);
 }
 async categories(){
  // Rebuild only the derived visible category order. Plotted values stay at
  // their original data roots; text references are shared without hydration.
  this.reader.presentation.collections.categories={count:0,root:null};this.reader.presentationIndex.collections.categories=emptyIndexes();
  for await(const panel of this.reader.memberRows({collection:'panels'})){
   if((await this.tree.selected(panel.body,['header','x','kind'])).value!=='category')continue;let count=0,maximum=0;
   for await(const series of this.reader.memberRows({collection:'series',plotId:panel.plotId})){
    if((await this.tree.selected(series.body,['style','visible'])).value===false)continue;
    for await(const point of this.reader.memberRows({collection:'points',plotId:panel.plotId,seriesId:series.id})){
     this.check();const id=point.categoryId;if(await this.index.find({root:this.reader.collection('categories').indexes.keys},id))continue;
     const selected=await this.tree.select(point.body,['x']),body=selected.inline?await this.tree.retain(selected.value):selected.revision,texts={'':point.texts.x};maximum=Math.max(maximum,texts['']);
     await this.setMember({format:'figure-member',version:1,collection:'categories',id,plotId:panel.plotId,seriesId:null,position:count++,ordinal:this.reader.presentation.collections.categories.count++,body,texts});
    }
   }
   const domains={...(await this.tree.selected(panel.body,['domains'])).value,categoryCount:count,maximumCategoryLength:maximum},body=await this.property(panel.body,[],'domains',domains);await this.setMember({...panel,body},panel);
  }
 }
 async apply(operation){
  if(!validRetainedFigureOperation(operation))invalid();await this.initialize();this.check();
  if(['append','remove','move'].includes(operation.type))await this.rewrite(operation.collection,operation);
  else{
   const target=await this.target(operation);let root,texts;
   if(operation.type==='patch')({root,texts}=await this.applyPatch(operation,target));
   else if(operation.type==='threshold')({root,texts}=await this.applyThreshold(operation,target));
   else{
    if(!stringFields[operation.collection].includes(operation.field)&&!(operation.collection==='header'&&/^heatmap\.thresholds\.(?:[0-9]|[12][0-9]|3[01])\.label$/.test(operation.field)))invalid();const path=[...target.path,...operation.field.split('.')],key=path.join('.'),result=await spliceFigureText(this.blocks,target.root,path,target.texts[key],operation,{required:!['x.label','y.label','heatmap.valueLabel'].includes(operation.field),annotation:['annotations','ticks','panels'].includes(operation.collection)||operation.field.startsWith('heatmap.'),signal:this.signal});
    root=await new RecordDocument(this.blocks,target.root,{mutable:true}).replaceReference(target.root,path,result.root,{signal:this.signal});texts={...target.texts,[key]:result.total};
   }
   if(target.member){const member={...target.member,body:root,texts};await this.validateMember(member);await this.setMember(member,target.member);this.changedPlots.add(member.plotId);if(operation.collection==='series'&&operation.type==='patch'&&Object.hasOwn(operation.patch,'style')&&Object.hasOwn(operation.patch.style,'visible'))this.rebuildCategories=true;
    if(target.global){const selected=await this.tree.select(root,['header']);this.reader.presentation.header=selected.inline?await this.tree.retain(selected.value):selected.revision;this.reader.presentation.headerTexts=Object.fromEntries(Object.entries(texts).filter(([key])=>key.startsWith('header.')).map(([key,value])=>[key.slice(7),value]));}
   }else{await this.validateHeader(substitute(await this.reader.bounded(root,texts)));this.reader.presentation.header=root;this.reader.presentation.headerTexts=texts;}
  }
  if(this.rebuildCategories){await this.categories();for await(const panel of this.reader.memberRows({collection:'panels'}))await this.refresh(panel.plotId);}else for(const plotId of this.changedPlots)await this.refresh(plotId);
  if(operation.collection==='header'&&operation.type==='patch'&&['x','y','markerArea','heatmap'].some(key=>Object.hasOwn(operation.patch,key)))for(const plotId of this.changedPlots)await this.validatePlotConstraints(plotId,{points:true});
  if(operation.collection==='header'||operation.collection==='ticks')await this.reader.validateLinkedAxes({signal:this.signal});await this.checkpoint();
  const presentation={root:await this.tree.retain(this.reader.presentation),index:await this.tree.retain(this.reader.presentationIndex)},counts={...this.reader.document.counts};for(const name of ['panels','series','annotations','ticks'])counts[name]=this.reader.presentation.collections[name]?.count??0;
  const title=(await this.reader.bounded(this.reader.presentation.header,this.reader.presentation.headerTexts)).title,figure={...this.reader.figure,title,document:{...this.reader.document,presentation,counts}};await this.blocks.flush();return figure;
 }
}
export async function changeRetainedFigure(documents,figure,operation,{signal}={}){const reader=await documents.open(figure);return new RetainedFigurePresentation(documents,reader,{signal}).apply(operation);}


const receiptPrefix='figure-edits';
const receiptFile=(materials,recordId,operationId)=>materials.metadataFile(receiptPrefix+'/'+recordId+'/'+operationId+'.json');
async function validateReceipt(materials,receipt,{recordId,operationId,commandHash}={}){
 if(!receipt||Object.keys(receipt).sort().join()!=='commandHash,operationId,recordId,result,source,version'||receipt.version!==1||!researchId(receipt.operationId)||!researchId(receipt.recordId)||!revisionId(receipt.commandHash)||!validMaterialReference(receipt.source)||receipt.source.kind!=='analysis'||!validMaterialReference(receipt.result)||receipt.result.kind!=='analysis'||recordId!==undefined&&receipt.recordId!==recordId||operationId!==undefined&&receipt.operationId!==operationId)throw new AppError('CATALOGUE_DAMAGED');
 if(commandHash!==undefined&&receipt.commandHash!==commandHash)throw new AppError('MATERIAL_CHANGED');const doc=await materials.read(receipt.result);if(doc.recordId!==receipt.recordId||!validRetainedFigure(doc.content.figure)||receipt.source.id===receipt.result.id&&doc.previous!==receipt.source.revision)throw new AppError('CATALOGUE_DAMAGED');return {ref:receipt.result,figure:doc.content.figure};
}
export async function changeRetainedFigureRequest(materials,command,{signal}={}){
 if(!command||Object.keys(command).sort().join()!=='operation,operationId,recordId,ref'||!researchId(command.recordId)||!researchId(command.operationId)||!validMaterialReference(command.ref)||command.ref.kind!=='analysis'||!validRetainedFigureOperation(command.operation))invalid();
 command=structuredClone(command);const commandHash=digest(revisionText(command)),file=receiptFile(materials,command.recordId,command.operationId),replay=async()=>{signal?.throwIfAborted();const receipt=await materials.json(file,{missing:true});return receipt?validateReceipt(materials,receipt,{...command,commandHash}):null;};
 await materials.assertOwner(command.recordId,{write:true});const recovered=await replay();if(recovered)return recovered;
 const source=await materials.read(command.ref);if(!validRetainedFigure(source.content.figure))invalid();const previous=await materials.current(command.ref.id);void previous;
 const write=operation=>materials.workspace.withLock(operation),documents=new RetainedFigureDocuments(materials.workspace,{write,signal}),figure=await changeRetainedFigure(documents,source.content.figure,command.operation,{signal});
 return write(async()=>{signal?.throwIfAborted();await materials.assertOwner(command.recordId,{write:true});const recovered=await replay();if(recovered)return recovered;await materials.read(command.ref);const current=await materials.current(command.ref.id),sameBranch=source.recordId===command.recordId&&current?.revision===command.ref.revision;const ref=await materials.commit({kind:'analysis',recordId:command.recordId,title:source.title,...(sameBranch?{id:source.id,expectedRevision:command.ref.revision}:{}),content:{...source.content,figure}});await materials.put(file,{version:1,operationId:command.operationId,recordId:command.recordId,commandHash,source:command.ref,result:ref});return {ref,figure};});
}
export async function verifyFigurePresentationReceipts(materials,{signal}={}){
 for await(const recordId of materials.names(receiptPrefix)){if(!researchId(recordId))throw new AppError('CATALOGUE_DAMAGED');for await(const name of materials.names(receiptPrefix+'/'+recordId)){signal?.throwIfAborted();if(!/^[a-f0-9-]{36}\.json$/.test(name)||!researchId(name.slice(0,-5)))throw new AppError('CATALOGUE_DAMAGED');await validateReceipt(materials,await materials.json(receiptFile(materials,recordId,name.slice(0,-5))),{recordId,operationId:name.slice(0,-5)});}}
}
