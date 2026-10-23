// Immutable manual figure drafts share the retained figure's counted indexes.
// The authoring format is intentionally unreadable by ordinary exporters.
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {RetainedFigureDocuments,RetainedFigureCollections,figureValidationValue} from './retained-figure-document.js';
import {RetainedFigurePresentation,spliceFigureText} from './retained-figure-presentation.js';
import {RecordDocument} from './record-document.js';
import {recordTextJSON} from './record-string-stream.js';
import {serialize, digest} from './storage-format.js';
import {validRetainedFigure} from './web/retained-figure-model.js';
import {validManualFigureOperation,validAuthoredPointPatch,validAuthoredPointOrigin} from './web/retained-figure-authoring-model.js';
import {validRetainedFigureOperation} from './web/retained-figure-presentation-model.js';
import {createFigure,createSeries,FIGURE_TYPES,figureIssues} from './web/figure-model.js';
import {validSeriesStyle} from './web/figure-style.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
import {axisControlIssues} from './web/figure-axis-controls.js';
import {sameAxisProjection} from './web/figure-projection-display.js';
import {defaultHeatmap} from './web/figure-heatmap.js';
import {researchId} from './web/research-reference.js';
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const missing=()=>{throw new AppError('MATERIAL_MISSING');};
const ordinal=value=>String(value).padStart(16,'0');
const lengths=(value,path='',result={})=>{if(typeof value==='string')result[path]=value.length;else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))lengths(child,path?path+'.'+key:key,result);return result;};
const emptyIndexes=()=>({keys:null,plots:null,series:null,lookup:null,coordinates:null});
const identity=hex=>hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
const readRef=async(tree,root,path=[])=>{const selected=await tree.select(root,path);if(!selected)invalid();return selected.inline?tree.retain(selected.value):selected.revision;};
async function textHashes(reader,root,path,total,{required=false,plotId}={}){
 const hash=createHash('sha256'),category=plotId?createHash('sha256').update('[\n  '+JSON.stringify(plotId)+',\n  '):null;let count=0,nonblank=false;
 async function* checked(){for await(const chunk of reader.tree.text(root,path,{signal:reader.storage.signal})){count+=chunk.length;if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(chunk))invalid();if(chunk.trim())nonblank=true;yield chunk;}}
 for await(const chunk of recordTextJSON(checked(),{signal:reader.storage.signal})){hash.update(chunk);category?.update(chunk);}
 if(count!==total)missing();if(required&&!nonblank)invalid();return {hash:hash.update('\n').digest('hex'),...(category?{categoryId:identity(category.update('\n]\n').digest('hex'))}:{})};
}
async function validateTextMap(reader,root,texts,{required=[]}={}){
 if(!texts||typeof texts!=='object'||Array.isArray(texts))missing();
 for(const [field,total]of Object.entries(texts)){if(!Number.isSafeInteger(total)||total<0)missing();await textHashes(reader,root,field?field.split('.'):[],total,{required:required.includes(field)});}
 const value=await reader.bounded(root,texts),expected={};
 const visit=(child,path='')=>{if(child?.format==='figure-text')expected[path]=child.characters;else if(typeof child==='string')expected[path]=child.length;else if(child&&typeof child==='object')for(const [key,item]of Object.entries(child))visit(item,path?path+'.'+key:key);};visit(value);
 if(serialize(expected)!==serialize(texts)){
  const keys=Object.keys(expected).sort();if(keys.join()!==Object.keys(texts).sort().join()||keys.some(key=>expected[key]!==texts[key]))missing();
 }
 return value;
}
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===fields.sort().join();
function structuralHeader(value){
 const header=figureValidationValue(value);if(!researchId(header.id)||typeof header.title!=='string')missing();
 if(header.kind==='panels'){if(!exact(header,['id','title','kind','layout'])||!exact(header.layout,['columns','linkX','linkY'])||!Number.isInteger(header.layout.columns)||header.layout.columns<1||header.layout.columns>3||typeof header.layout.linkX!=='boolean'||typeof header.layout.linkY!=='boolean')missing();return;}
 if(!FIGURE_TYPES.some(([kind])=>kind===header.kind)||!['number','date','category'].includes(header.x?.kind))missing();
 // A draft can intentionally contain axes/values incompatible with a changed
 // plot type. Check its fields now; strict finish checks their relationship.
 const normalized={...header,kind:'line',x:{...header.x,kind:'number'},series:[{id:header.id,name:'Draft',color:'#123456',points:[]}]};delete normalized.heatmap;delete normalized.projection;
 if(figureIssues(normalized,{draft:true,retained:true}).length)missing();
}
function structuralMember(member,value){
 const body=figureValidationValue(value),finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e100;
 if(member.collection==='panels'){if(!exact(body,['plotId','label','header','slots','domains'])||body.plotId!==member.plotId||body.header?.id!==member.plotId||typeof body.label!=='string'||!exact(body.slots,['annotations','xTicks','yTicks'])||Object.values(body.slots).some(value=>typeof value!=='boolean'))missing();structuralHeader(body.header);}
 else if(member.collection==='series'){if(!exact(body,['id','name','color',...(Object.hasOwn(body,'style')?['style']:[])])||body.id!==member.id||typeof body.name!=='string'||!/^#[0-9a-f]{6}$/i.test(body.color)||body.style!==undefined&&!validSeriesStyle(body.style))missing();}
 else if(member.collection==='points'){const {source,...point}=body;if(source&&Object.hasOwn(source,'origin')&&!validAuthoredPointOrigin(source.origin))missing();if(!Object.hasOwn(point,'x')||!Object.hasOwn(point,'y')||!Object.hasOwn(point,'error')||!validAuthoredPointPatch(point))missing();}
 else if(member.collection==='ticks'){if(!exact(body,['axis','value','label'])||!['x','y'].includes(body.axis)||!finite(body.value)||typeof body.label!=='string')missing();}
 else if(member.collection==='annotations'){
  const fields={boundary:['axis','start','end'],interval:['axis','start','end'],region:['xLower','xUpper','yLower','yUpper'],callout:['seriesId','pointIndex','dx','dy']};
  if(!fields[body.kind]||!exact(body,['id','kind','label','color','opacity',...fields[body.kind]])||body.id!==member.id||typeof body.label!=='string'||!/^#[0-9a-f]{6}$/i.test(body.color)||!finite(body.opacity)||body.opacity<0||body.opacity>1)missing();
  if(body.kind==='callout'){if(!researchId(body.seriesId)||!Number.isSafeInteger(body.pointIndex)||body.pointIndex<0||![body.dx,body.dy].every(value=>finite(value)&&Math.abs(value)<=2000))missing();}
  else for(const key of fields[body.kind]){const value=body[key];if(key==='axis'){if(!['x','y'].includes(value))missing();}else if(!(value===null||finite(value)||typeof value==='string'))missing();}
 }
}
class DraftEdit extends RetainedFigurePresentation{
 constructor(owner,reader){super(owner.documents,reader,{signal:owner.signal});this.owner=owner;}
 async initialize(){await super.initialize();this.reader.data=structuredClone(this.reader.data);this.reader.dataIndex=structuredClone(this.reader.dataIndex);return this;}
 tables(collection){return collection==='points'?{body:this.reader.data,index:this.reader.dataIndex}:{body:this.reader.presentation,index:this.reader.presentationIndex};}
 async checkpoint(){await this.index.flushRoots([this.reader.data,this.reader.presentation].flatMap(body=>Object.values(body.collections).map(value=>value.root)).concat([this.reader.dataIndex,this.reader.presentationIndex].flatMap(body=>Object.values(body.collections).flatMap(value=>Object.values(value)))));}
 async setMember(member){
  const {body,index}=this.tables(member.collection),collection=body.collections[member.collection]??={count:0,root:null},indexes=index.collections[member.collection]??=emptyIndexes();
  const revision=await this.tree.retain(member);collection.root=await this.index.change(collection.root,ordinal(member.ordinal),revision);indexes.keys=await this.index.change(indexes.keys,member.id,revision);
  if(member.plotId)indexes.plots=await this.index.change(indexes.plots,member.plotId+':'+ordinal(member.ordinal),revision);
  if(member.seriesId)indexes.series=await this.index.change(indexes.series,member.seriesId+':'+ordinal(member.position),revision);
  if(this.index.pending.size>=128||this.index.pendingBytes>=262144)await this.checkpoint();return member;
 }
 async append(collection,value,{id=randomUUID(),plotId=null,seriesId=null,bodyRoot=null,texts=null}={}){
  const {body,index}=this.tables(collection),rows=body.collections[collection]??={count:0,root:null};index.collections[collection]??=emptyIndexes();
  if(await this.reader.item({collection,id}))invalid();
  const position=collection==='panels'?rows.count:collection==='points'?(await this.reader.scope({collection,seriesId})).total:plotId?(await this.reader.scope({collection,plotId})).total:rows.count;
  return this.setMember({format:'figure-member',version:1,collection,id,plotId,seriesId,position,ordinal:rows.count++,body:bodyRoot??await this.tree.retain(value),texts:texts??lengths(value)});
 }
 async rewrite(collection,{keep=()=>true,selected=null,other=null}={}){
  const prior=this.reader.collection(collection).collection,root=prior.root,total=prior.count,{body,index}=this.tables(collection);body.collections[collection]={count:0,root:null};index.collections[collection]=emptyIndexes();
  for(let at=0;at<total;at++){
   this.check();const entry=await this.index.entryAt({root},at);let member=await this.reader.member(entry.revision,collection);if(!await keep(member))continue;
   if(other){if(member.id===selected.id)member=other;else if(member.id===other.id)member=selected;}
   await this.append(collection,null,{id:member.id,plotId:member.plotId,seriesId:member.seriesId,bodyRoot:member.body,texts:member.texts});
  }
 }
 async point(operation){
  const member=await this.member('points',operation.id,operation.plotId);let body=member.body,texts={...member.texts};
  if(operation.type==='patch'){let changed=false;for(const [key,value]of Object.entries(operation.patch)){const length=texts[key];if(Number.isSafeInteger(length)&&(typeof value!=='string'||length!==value.length)){changed=true;continue;}const prior=await this.tree.selected(body,[key]);if(!prior.found||prior.value!==value)changed=true;}if(!changed)return;}
  else if(operation.remove===0&&operation.text==='')return;
  else if(operation.remove<=16384&&operation.remove===operation.text.length){const prior=await this.reader.text({collection:'points',id:member.id,field:'x',offset:operation.offset,limit:Math.max(1,operation.remove)});if(prior.text===operation.text)return;}
  if(operation.type==='patch'){
   if(!validAuthoredPointPatch(operation.patch))invalid();for(const [key,value]of Object.entries(operation.patch)){body=await this.property(body,[],key,value);delete texts[key];if(typeof value==='string')texts[key]=value.length;}
  }else{
   const result=await spliceFigureText(this.blocks,body,['x'],texts.x,operation,{signal:this.signal});body=await new RecordDocument(this.blocks,body,{mutable:true}).replaceReference(body,['x'],result.root,{signal:this.signal});texts.x=result.total;
  }
  if(await this.tree.select(body,['source']))body=(await new RecordDocument(this.blocks,body,{mutable:true}).property([],'source',null,{remove:true,signal:this.signal})).root;
  for(const key of Object.keys(texts))if(key==='source'||key.startsWith('source.'))delete texts[key];
  await this.setMember({...member,body,texts});
 }
 async target(operation){
  if(operation.collection==='header'){
   const scope=await this.reader.scope({collection:'panels'});
   if(!scope.total){if(operation.plotId||operation.id&&operation.id!==this.reader.figure.id)invalid();return {member:null,root:this.reader.presentation.header,path:[],texts:this.reader.presentation.headerTexts,global:true};}
   if((await this.tree.selected(this.reader.presentation.header,['kind'])).value!=='panels'){
    if(scope.total!==1)missing();const entry=await this.index.entryAt({root:scope.root},scope.start),panel=await this.reader.member(entry.revision,'panels');
    if(operation.plotId&&operation.plotId!==panel.plotId||operation.id&&![this.reader.figure.id,panel.plotId].includes(operation.id))invalid();
    // The selected record keeps its wrapper ID when a different plot is
    // imported. Resolve that one indexed plot and preserve the effective
    // wrapper header (including an independently edited display title).
    const header=await this.property(this.reader.presentation.header,[],'id',panel.plotId),root=await new RecordDocument(this.blocks,panel.body,{mutable:true}).replaceReference(panel.body,['header'],header,{signal:this.signal}),texts=Object.fromEntries(Object.entries(panel.texts).filter(([key])=>!key.startsWith('header.')));
    for(const [key,total]of Object.entries(this.reader.presentation.headerTexts))texts['header.'+key]=key==='id'?panel.plotId.length:total;
    return {member:panel,root,path:['header'],texts,global:true};
   }
  }
  return super.target(operation);
 }
 async presentation(operation){
  const target=await this.target(operation);let root,texts;
  if(operation.type==='patch'){
   const patch={...operation.patch};
   if(operation.collection==='header'){
    if(patch.markerArea===null){
     target.root=(await new RecordDocument(this.blocks,target.root,{mutable:true}).property(target.path,'markerArea',null,{remove:true,signal:this.signal})).root;
     const prefix=[...target.path,'markerArea'].join('.');target.texts=Object.fromEntries(Object.entries(target.texts).filter(([key])=>key!==prefix&&!key.startsWith(prefix+'.')));delete patch.markerArea;
    }
    if(Object.hasOwn(patch,'kind')){if(!FIGURE_TYPES.some(([kind])=>kind===patch.kind))invalid();target.root=await this.property(target.root,target.path,'kind',patch.kind);if(patch.kind==='heatmap'&&!await this.tree.select(target.root,[...target.path,'heatmap'])){const settings=defaultHeatmap();target.root=await this.property(target.root,target.path,'heatmap',settings);target.texts={...target.texts,...lengths(settings,[...target.path,'heatmap'].join('.'))};}delete patch.kind;}
    if(patch.x&&Object.hasOwn(patch.x,'kind')){if(!['number','date','category'].includes(patch.x.kind))invalid();target.root=await this.property(target.root,[...target.path,'x'],'kind',patch.x.kind);patch.x={...patch.x};delete patch.x.kind;if(!Object.keys(patch.x).length)delete patch.x;}
   }
   ({root,texts}=Object.keys(patch).length?await this.applyPatch({...operation,patch},target):{root:target.root,texts:{...target.texts}});
   // Type labels are short inline strings, and must participate in text proof.
   if(operation.collection==='header'){if(Object.hasOwn(operation.patch,'kind'))texts[[...target.path,'kind'].join('.')]=operation.patch.kind.length;if(operation.patch.x?.kind)texts[[...target.path,'x','kind'].join('.')]=operation.patch.x.kind.length;}
  }else if(operation.type==='threshold')({root,texts}=await this.applyThreshold(operation,target));
  else{
   const allowed={header:['title','x.label','y.label','markerArea.label','heatmap.valueLabel'],panels:['label'],series:['name'],annotations:['label'],ticks:['label']};
   if(!allowed[operation.collection]?.includes(operation.field)&&!(operation.collection==='header'&&/^heatmap\.thresholds\.(?:[0-9]|[12][0-9]|3[01])\.label$/.test(operation.field)))invalid();
   const path=[...target.path,...operation.field.split('.')],key=path.join('.'),result=await spliceFigureText(this.blocks,target.root,path,target.texts[key],operation,{signal:this.signal});
   root=await new RecordDocument(this.blocks,target.root,{mutable:true}).replaceReference(target.root,path,result.root,{signal:this.signal});texts={...target.texts,[key]:result.total};
  }
  if(target.member){await this.setMember({...target.member,body:root,texts});if(target.global){this.reader.presentation.header=await this.property(await readRef(this.tree,root,['header']),[],'id',this.reader.figure.id);this.reader.presentation.headerTexts={...Object.fromEntries(Object.entries(texts).filter(([key])=>key.startsWith('header.')).map(([key,value])=>[key.slice(7),value])),id:this.reader.figure.id.length};}}
  else{this.reader.presentation.header=root;this.reader.presentation.headerTexts=texts;}
 }
 async panel(value){
  const plot=createFigure();plot.title=value.label;plot.kind=value.kind;plot.x.kind=value.xKind;if(value.kind==='heatmap')plot.heatmap=defaultHeatmap();
  const {series,...header}=plot;const row=await this.append('panels',{plotId:plot.id,label:value.label,header,slots:{annotations:false,xTicks:false,yTicks:false},domains:{}},{plotId:plot.id});
  for(const seriesValue of series){const {points,...body}=seriesValue;await this.append('series',body,{id:body.id,plotId:plot.id});}return row;
 }
 async callouts(selected,{other=null,remove=false}={}){
  if(!['points','series'].includes(selected.collection))return;
  for await(const member of this.reader.memberRows({collection:'annotations',plotId:selected.plotId})){
   const value=await this.reader.bounded(member.body,member.texts);if(value.kind!=='callout'||value.seriesId!==(selected.collection==='series'?selected.id:selected.seriesId))continue;
   if(remove&&(selected.collection==='series'||value.pointIndex===selected.position))invalid();
   let position=value.pointIndex;if(other){if(position===selected.position)position=other.position;else if(position===other.position)position=selected.position;}else if(remove&&position>selected.position)position--;
   if(position!==value.pointIndex)await this.setMember({...member,body:await this.property(member.body,[],'pointIndex',position)});
  }
 }
 async structural(operation){
  const collection=operation.collection;
  if(operation.type==='append'){
   if(collection==='panels'){if((await this.tree.selected(this.reader.presentation.header,['kind'])).value!=='panels')invalid();await this.panel(operation.value);return;}
   await this.reader.panelMember(operation.plotId);
   if(collection==='points'){const series=await this.member('series',operation.seriesId,operation.plotId);await this.append(collection,operation.value,{plotId:operation.plotId,seriesId:series.id});}
   else if(collection==='series'){const value={id:randomUUID(),...operation.value};await this.append(collection,value,{id:value.id,plotId:operation.plotId});}
   else await this.append(collection,operation.value,{id:collection==='annotations'?operation.value.id:randomUUID(),plotId:operation.plotId});return;
  }
  const selected=await this.member(collection,operation.id,operation.plotId);
  if(operation.type==='move'){
   const scope=await this.reader.scope({collection,...(collection==='points'?{seriesId:selected.seriesId}:collection==='panels'?{}:{plotId:selected.plotId})}),position=collection==='panels'?selected.ordinal:selected.position,next=position+operation.direction;
   if(next<0||next>=scope.total)return;const entry=await this.index.entryAt({root:scope.root},scope.start+next),other=await this.reader.member(entry.revision,collection);if(collection==='points')await this.callouts(selected,{other});await this.rewrite(collection,{selected,other});return;
  }
  await this.callouts(selected,{remove:true});await this.rewrite(collection,{keep:member=>member.id!==selected.id});
  if(collection==='series')await this.rewrite('points',{keep:member=>member.seriesId!==selected.id});
  if(collection==='panels')for(const child of ['series','points','annotations','ticks'])await this.rewrite(child,{keep:member=>member.plotId!==selected.plotId});
 }
 async finish(){
  await this.checkpoint();this.reader.dataIndex.collections=Object.fromEntries(Object.entries(this.reader.dataIndex.collections).filter(([key])=>Object.hasOwn(this.reader.data.collections,key)));
  const data={root:await this.tree.retain(this.reader.data),index:await this.tree.retain(this.reader.dataIndex)};this.reader.presentation.data=data.root;
  const presentation={root:await this.tree.retain(this.reader.presentation),index:await this.tree.retain(this.reader.presentationIndex)},counts=Object.fromEntries(['panels','series','points','annotations','ticks'].map(name=>[name,this.reader.collection(name).collection.count]));
  const figure={id:this.reader.figure.id,title:(await this.reader.bounded(this.reader.presentation.header,this.reader.presentation.headerTexts)).title,kind:'retained',version:1,document:{format:'figure-authoring',version:1,data,presentation,counts}};
  if(!validRetainedFigure(figure,{draft:true}))invalid();await this.blocks.flush();return figure;
 }
}
export class RetainedFigureAuthoring{
 constructor(workspace,options={}){this.documents=new RetainedFigureDocuments(workspace,options);this.signal=options.signal;this.readOnly=!!options.readOnly;}
 check(){this.signal?.throwIfAborted();if(this.readOnly)invalid();}
 open(figure){return this.documents.open(figure,{draft:true});}
 async origin(edit,member,ref,index=null){
  const current=await edit.tree.selected(member.body,['source','origin']);if(current.found){if(!validAuthoredPointOrigin(current.value))missing();return member;}if(!ref)return member;
  const origin={ref:structuredClone(ref),...(index===null?{seriesId:member.seriesId,pointId:member.id}:{index})};if(!validAuthoredPointOrigin(origin))invalid();let body=member.body;
  if(!await edit.tree.select(body,['source']))body=await edit.property(body,[],'source',{});
  body=await edit.property(body,['source'],'origin',origin);return {...member,body,texts:{...member.texts,...lengths(origin,'source.origin')}};
 }
 async draft(figure,{bindSource=true}={}){
  const reader=await this.open(figure),edit=await new DraftEdit(this,reader).initialize();
  // These indexes summarize rendered domains, not authored values. They are
  // rebuilt on strict finish and cannot advertise stale coordinates in drafts.
  for(const name of ['plots','series']){delete reader.data.collections[name];delete reader.dataIndex.collections[name];}
  delete reader.presentation.collections.categories;delete reader.presentationIndex.collections.categories;
  for(const body of [reader.dataIndex,reader.presentationIndex])for(const index of Object.values(body.collections)){index.lookup=null;index.coordinates=null;}
  if(bindSource&&figure.source)for await(const member of reader.memberRows({collection:'points'})){const bound=await this.origin(edit,member,figure.source);if(bound!==member)await edit.setMember(bound);}
  reader.presentation.header=await edit.property(reader.presentation.header,[],'id',figure.id);reader.presentation.headerTexts.id=figure.id.length;
  if(typeof figure.title==='string'){reader.presentation.header=await edit.property(reader.presentation.header,[],'title',figure.title);reader.presentation.headerTexts.title=figure.title.length;}
  return edit.finish();
 }
 async start(input=null,{id=input?.id??randomUUID(),kind='plot'}={}){
  this.check();if(!researchId(id)||!['plot','panels'].includes(kind))invalid();
  if(input?.kind==='retained'){if(!validRetainedFigure(input,{draft:true}))invalid();return this.draft({...input,id});}
  const value=input??(kind==='panels'?{id,title:'Data figure',kind:'panels',layout:{columns:2,linkX:false,linkY:false},panels:[]}:{...createFigure(),id});
  if(value.kind==='panels'&&value.panels.some(panel=>panel.figure.kind==='retained')){
   let draft=await this.draft(await this.documents.builder({...value,id},{draft:true}).finish(),{bindSource:false}),index=0;
   for(const panel of value.panels){
    let child=panel.figure;
    if(child.kind!=='retained')child=await this.finish(await this.inline(child,child.id,{ref:value.source,index}));
    const from=await this.documents.open(child);if((await from.scope({collection:'panels'})).total!==1)invalid();
    draft=await this.import(draft,child,{mode:'panel',panelIdentity:{id:panel.id,plotId:panel.figure.id,label:panel.label,...(!panel.figure.source&&value.source?{origin:{ref:value.source,index}}:{})}});index+=child.document.counts.points;
   }
   return draft;
  }
  return this.inline(value,id);
 }
 async inline(value,id,{ref:inherited,index=0}={}){
  const builder=this.documents.builder({...value,id},{draft:true});
  for(const panel of value.kind==='panels'?value.panels:[{id:value.id,label:value.title,figure:value}]){
   let panelIndex=0;const ref=panel.figure.source??value.source??inherited;
   await builder.addPlot(panel.figure,{id:panel.id,label:panel.label});
   for(const series of panel.figure.series){
    await builder.addSeries(series);
    for(const point of series.points??[]){
     const {source,...body}=point;let receipt=source;
     if(source&&Object.hasOwn(source,'origin')){if(!validAuthoredPointOrigin(source.origin))invalid();}
     else if(ref){const origin={ref:structuredClone(ref),index:panel.figure.source?panelIndex:index};if(!validAuthoredPointOrigin(origin))invalid();receipt={...source,origin};}
     await builder.addPoint(body,{source:receipt});index++;panelIndex++;
    }
   }
  }
  return this.draft(await builder.finish(),{bindSource:false});
 }
 async change(figure,operation){
  this.check();if(figure?.document?.format!=='figure-authoring'||!validManualFigureOperation(operation))invalid();
  const reader=await this.open(figure),edit=await new DraftEdit(this,reader).initialize();
  if(['append','remove','move'].includes(operation.type))await edit.structural(operation);
  else if(operation.collection==='points')await edit.point(operation);else await edit.presentation(operation);
  return edit.finish();
 }
 async verify(figure){
  const reader=await this.open(figure);if(figure.document.format==='figure-document')return reader.verify({signal:this.signal});
  const header=figureValidationValue(await validateTextMap(reader,reader.presentation.header,reader.presentation.headerTexts));
  structuralHeader(header);if(header.id!==figure.id||header.kind!=='panels'&&figure.document.counts.panels>1)missing();
  const allowed={data:['points'],presentation:['panels','series','annotations','ticks']};
  for(const name of ['data','presentation']){
   const body=reader[name],indices=reader[name+'Index'];if(Object.keys(body.collections).some(key=>!allowed[name].includes(key))||Object.keys(body.collections).sort().join()!==Object.keys(indices.collections).sort().join())missing();
   for(const [collection,rows]of Object.entries(body.collections)){
    const indexes=indices.collections[collection];if(Object.keys(indexes).sort().join()!==Object.keys(emptyIndexes()).sort().join()||indexes.lookup!==null||indexes.coordinates!==null)missing();
    let count=0,plots=0,series=0;
    for await(const entry of reader.index.entries({root:rows.root})){
     this.signal?.throwIfAborted();const member=await reader.member(entry.revision,collection);if(member.ordinal!==count||entry.id!==ordinal(count++))missing();
     const expected={keys:member.id};if(member.plotId){plots++;expected.plots=member.plotId+':'+ordinal(member.ordinal);if(collection!=='panels')await reader.panelMember(member.plotId);}if(member.seriesId){series++;expected.series=member.seriesId+':'+ordinal(member.position);const parent=await reader.item({collection:'series',id:member.seriesId,plotId:member.plotId});if(!parent)missing();}
     for(const [slot,key]of Object.entries(expected))if((await reader.index.find({root:indexes[slot]},key))?.revision!==entry.revision)missing();
     const value=await validateTextMap(reader,member.body,member.texts);structuralMember(member,value);
     if(collection==='panels'){if(member.position!==member.ordinal||(await reader.scope({collection,plotId:member.plotId})).total!==1)missing();}
     else{const scope=await reader.scope({collection,...(collection==='points'?{seriesId:member.seriesId}:{plotId:member.plotId})}),key=collection==='points'?member.seriesId+':'+ordinal(member.position):member.plotId+':'+ordinal(member.ordinal);if(member.position!==await reader.index.rank({root:scope.root},key)-scope.start)missing();}
    }
    if(count!==rows.count||(indexes.plots?.count??0)!==plots||(indexes.series?.count??0)!==series)missing();
    for(const root of [rows.root,...Object.values(indexes)])for await(const node of reader.index.nodes(root,{signal:this.signal}))void node;
   }
  }
  for await(const block of reader.blocks({signal:this.signal}))void block;return {...figure.document.counts};
 }
 async finish(figure){
  this.check();const reader=await this.open(figure);await this.verify(figure);
  const rootHeader=figureValidationValue(await validateTextMap(reader,reader.presentation.header,reader.presentation.headerTexts,{required:['title']})),builder=this.documents.builder(rootHeader,{retained:{root:reader.presentation.header,texts:reader.presentation.headerTexts}});
  if(rootHeader.kind==='panels'?figure.document.counts.panels<2:figure.document.counts.panels!==1)invalid();
  for await(const panel of reader.memberRows({collection:'panels'})){
   this.signal?.throwIfAborted();const body=figureValidationValue(await validateTextMap(reader,panel.body,panel.texts,{required:['label','header.title']}));
   await builder.addPlot(body.header,{id:panel.id,label:body.label,retained:{root:panel.body,texts:panel.texts}});let seriesCount=0;
   for await(const series of reader.memberRows({collection:'series',plotId:panel.plotId})){
    seriesCount++;const value=figureValidationValue(await validateTextMap(reader,series.body,series.texts,{required:['name']})),nameHash=(await textHashes(reader,series.body,['name'],series.texts.name,{required:true})).hash;
    await builder.addSeries(value,{retained:{root:series.body,texts:series.texts,nameHash}});
    for await(const point of reader.memberRows({collection:'points',plotId:panel.plotId,seriesId:series.id})){
     const value=await validateTextMap(reader,point.body,point.texts),{source,...coordinates}=figureValidationValue(value);void source;
     const retained={root:point.body,texts:point.texts};
     if(typeof value.x==='string'||value.x?.format==='figure-text'){
      const hashes=await textHashes(reader,point.body,['x'],point.texts.x,{required:true,plotId:panel.plotId});retained.xHash=hashes.hash;retained.categoryId=hashes.categoryId;retained.xRoot=await readRef(reader.tree,point.body,['x']);
     }
     await builder.addPoint(coordinates,{id:point.id,retained});
    }
   }
   if(!seriesCount)invalid();
   for(const collection of ['ticks','annotations'])for await(const member of reader.memberRows({collection,plotId:panel.plotId})){
    const value=figureValidationValue(await validateTextMap(reader,member.body,member.texts,{required:['label']}));if(body.header.kind==='heatmap')invalid();if(collection==='ticks'&&(!['x','y'].includes(value.axis)||axisControlIssues({...body.header[value.axis],ticks:[{value:value.value,label:value.label}]},{kind:body.header[value.axis]?.kind??'number',retained:true}).length))invalid();const lookup=collection==='ticks'?panel.plotId+':'+value.axis+':'+numericKey(value.value):null;
    if(lookup!==null&&await builder.presentation.find(collection,lookup,'lookup'))invalid();
    await builder.presentation.add(collection,{id:member.id,plotId:panel.plotId,position:member.position,body:value,bodyRoot:member.body,texts:member.texts,lookup});
    builder.plot.slots[collection==='annotations'?'annotations':value.axis+'Ticks']=true;
    if(collection==='ticks'){const axis=builder.plot.domains[value.axis];if(!axis||!Number.isFinite(value.value))invalid();axis.min=axis.min===null?value.value:Math.min(axis.min,value.value);axis.max=axis.max===null?value.value:Math.max(axis.max,value.value);if(value.value>0){axis.positiveMin=axis.positiveMin===null?value.value:Math.min(axis.positiveMin,value.value);axis.positiveMax=axis.positiveMax===null?value.value:Math.max(axis.positiveMax,value.value);}}
   }
  }
  const saved=await builder.finish();delete saved.source;return saved;
 }
 async duplicate(figure,{id=randomUUID(),onMapped}={}){
  this.check();if(!researchId(id)||!validRetainedFigure(figure))invalid();
  const from=await this.documents.open(figure),header=figureValidationValue(await from.bounded(from.presentation.header,from.presentation.headerTexts));
  if(header.kind!=='panels'){const result={...figure,id};await onMapped?.({sourceId:figure.id,targetId:id});return result;}
  const empty=await this.documents.builder({...header,id},{draft:true,retained:{root:from.presentation.header,texts:from.presentation.headerTexts}}).finish(),reader=await this.open(empty),edit=await new DraftEdit(this,reader).initialize();
  reader.presentation.header=await edit.property(from.presentation.header,[],'id',id);reader.presentation.headerTexts={...from.presentation.headerTexts,id:id.length};
  if(typeof figure.title==='string'){reader.presentation.header=await edit.property(reader.presentation.header,[],'title',figure.title);reader.presentation.headerTexts.title=figure.title.length;}
  const draft=await this.import(await edit.finish(),figure,{mode:'panel',onMapped}),result=await this.finish(draft);await onMapped?.({sourceId:figure.id,targetId:id});return result;
 }
 async extract(figure,plotId,{id=plotId}={}){
  this.check();if(!researchId(id)||!researchId(plotId)||!validRetainedFigure(figure))invalid();
  const from=await this.documents.open(figure),single=(await from.tree.selected(from.presentation.header,['kind'])).value!=='panels';
  if(plotId===figure.id&&single)plotId=(await from.window({collection:'panels',limit:1})).items[0]?.plotId;
  if((await from.scope({collection:'panels',plotId})).total!==1)invalid();const selected=await from.panelMember(plotId);
  const sourceRoot=single?from.presentation.header:await readRef(from.tree,selected.body,['header']),texts=single?{...from.presentation.headerTexts}:Object.fromEntries(Object.entries(selected.texts).filter(([key])=>key.startsWith('header.')).map(([key,value])=>[key.slice(7),value])),header=figureValidationValue(await from.bounded(sourceRoot,texts));
  const empty=await this.documents.builder({...header,id},{draft:true,retained:{root:sourceRoot,texts}}).finish(),reader=await this.open(empty),edit=await new DraftEdit(this,reader).initialize();
  reader.presentation.header=await edit.property(sourceRoot,[],'id',id);reader.presentation.headerTexts.id=id.length;
  if(single&&typeof figure.title==='string'){reader.presentation.header=await edit.property(reader.presentation.header,[],'title',figure.title);reader.presentation.headerTexts.title=figure.title.length;}
  await edit.append('panels',null,{id:selected.id,plotId,bodyRoot:selected.body,texts:selected.texts});
  for await(const series of from.memberRows({collection:'series',plotId})){
   await edit.append('series',null,{id:series.id,plotId,bodyRoot:series.body,texts:series.texts});
   for await(const point of from.memberRows({collection:'points',plotId,seriesId:series.id})){const bound=await this.origin(edit,point,figure.source);await edit.append('points',null,{id:point.id,plotId,seriesId:series.id,bodyRoot:bound.body,texts:bound.texts});}
  }
  for(const collection of ['annotations','ticks'])for await(const member of from.memberRows({collection,plotId}))await edit.append(collection,null,{id:member.id,plotId,bodyRoot:member.body,texts:member.texts});
  return this.finish(await edit.finish());
 }
 async import(figure,source,{mode='replace',plotId,sourcePlotId,panelIdentity=null,onMapped}={}){

  this.check();if(!['replace','append','panel'].includes(mode)||!validRetainedFigure(source))invalid();
  if(sourcePlotId!==undefined){if(!researchId(sourcePlotId))invalid();source=await this.extract(source,sourcePlotId,{id:sourcePlotId});}
  if(mode==='replace'){const result=await this.start(source,{id:figure.id});await onMapped?.({sourceId:source.id,targetId:result.id});const reader=await this.open(result);if((await reader.header()).header.kind==='panels')for await(const panel of reader.memberRows({collection:'panels'}))await onMapped?.({sourceId:panel.plotId,targetId:panel.plotId});return result;}
  const target=await this.open(figure),from=await this.documents.open(source),edit=await new DraftEdit(this,target).initialize();
  if(mode==='panel'&&(await target.tree.selected(target.presentation.header,['kind'])).value!=='panels')invalid();
  if(panelIdentity&&(mode!=='panel'||!researchId(panelIdentity.id)||!researchId(panelIdentity.plotId)||typeof panelIdentity.label!=='string'||(await from.scope({collection:'panels'})).total!==1))invalid();
  if(mode==='append'){if(!researchId(plotId))invalid();await target.panelMember(plotId);}
  for await(const panel of from.memberRows({collection:'panels'})){
   let targetPlot=plotId;
   if(mode==='append'){const a=(await target.header({plotId})).header,b=(await from.header({plotId:panel.plotId})).header;if(a.x.kind!==b.x.kind||!sameAxisProjection(a,b,'x')||!sameAxisProjection(a,b,'y'))invalid();}
   if(mode==='panel'){
    targetPlot=panelIdentity?.plotId??randomUUID();let body=panel.body,texts={...panel.texts};body=await edit.property(body,[],'plotId',targetPlot);body=await edit.property(body,['header'],'id',targetPlot);
    if(panelIdentity){body=await edit.property(body,[],'label',panelIdentity.label);texts.label=panelIdentity.label.length;}
    if((await from.header()).header.kind!=='panels'&&typeof source.title==='string'){body=await edit.property(body,['header'],'title',source.title);texts['header.title']=source.title.length;}
    await edit.append('panels',null,{...(panelIdentity?{id:panelIdentity.id}:{}),plotId:targetPlot,bodyRoot:body,texts});
   }
   await onMapped?.({sourceId:(await from.header()).header.kind==='panels'?panel.plotId:source.id,targetId:targetPlot});
   for await(const series of from.memberRows({collection:'series',plotId:panel.plotId})){
    const id=randomUUID(),body=await edit.property(series.body,[],'id',id);await edit.append('series',null,{id,plotId:targetPlot,bodyRoot:body,texts:series.texts});
    for await(const point of from.memberRows({collection:'points',plotId:panel.plotId,seriesId:series.id})){const inherited=!source.source?panelIdentity?.origin:null,bound=await this.origin(edit,point,source.source??inherited?.ref,inherited?inherited.index+point.ordinal:null);await edit.append('points',null,{plotId:targetPlot,seriesId:id,bodyRoot:bound.body,texts:bound.texts});}
   }
   // Annotations identify source series. Import panels remaps these through
   // the source/target positional indexes without retaining an ID map.
   for(const collection of ['ticks','annotations'])for await(const member of from.memberRows({collection,plotId:panel.plotId})){
    let body=member.body,texts={...member.texts};if(collection==='annotations'){
     const annotation=await from.bounded(body,texts),id=randomUUID();body=await edit.property(body,[],'id',id);
     if(annotation.kind==='callout'){
      const sourceSeries=await from.item({collection:'series',id:annotation.seriesId,plotId:panel.plotId}),count=(await from.scope({collection:'series',plotId:panel.plotId})).total,targetCount=(await target.scope({collection:'series',plotId:targetPlot})).total;
      const item=(await target.window({collection:'series',plotId:targetPlot,offset:targetCount-count+sourceSeries.position,limit:1})).items[0];body=await edit.property(body,[],'seriesId',item.id);
     }
     await edit.append(collection,null,{id,plotId:targetPlot,bodyRoot:body,texts});
    }else await edit.append(collection,null,{plotId:targetPlot,bodyRoot:body,texts});
   }
  }
  return edit.finish();
 }
}
function numericKey(value){if(!Number.isFinite(value))invalid();const bytes=Buffer.alloc(8);bytes.writeDoubleBE(Object.is(value,-0)?0:value);if(bytes[0]&128)for(let i=0;i<8;i++)bytes[i]^=255;else bytes[0]^=128;return bytes.toString('hex');}
