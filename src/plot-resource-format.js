// Inspect only known numerical metadata shapes, never source text or payload strings.
export const plotResourceMaterial=value=>value?.content?.tool==='Observanda table mapping'&&value.content.version==='10';
export const hasPlotResourceFigure=figure=>figure?.projection?.version===2||figure?.kind==='panels'&&figure.panels?.some(panel=>hasPlotResourceFigure(panel.figure))===true;
export const hasPlotResourceFigures=record=>record?.figures?.some(hasPlotResourceFigure)===true;
export async function plotResourceFigureDocument(document,{signal}={}){
 if(!await document.tree.select(document.root,['figures']))return false;
 for await(const item of document.items(['figures'],{signal})){
  signal?.throwIfAborted();if((await document.tree.selected(item.value,['projection','version'])).value===2)return true;
  if((await document.tree.selected(item.value,['kind'])).value==='panels')for await(const panel of document.items(['figures',String(item.index),'panels'],{signal}))if((await document.tree.selected(panel.value,['figure','projection','version'])).value===2)return true;
 }return false;
}
export function plotResourceMetadata(relative,value){
 if(plotResourceMaterial(value)||relative.startsWith('.observanda/jobs/')&&value?.type==='figure.calculate'&&value.input?.command?.mapping?.resourcePolicy!==undefined)return true;
 if(!/^\.observanda\/materials\/figures\/value\/[a-f0-9]{64}\.json$/.test(relative))return false;
 // Long headers split into immutable property nodes; small headers stay inline.
 return value?.type==='property'&&value.name==='resourcePolicy'||value?.type==='inline'&&(value.value?.projection?.version===2||value.value?.version===2&&value.value.resourcePolicy!==undefined);
}
