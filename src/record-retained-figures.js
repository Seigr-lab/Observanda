// Capability detection reads compact figure kinds, never point collections.
export const hasRetainedFigure=figure=>figure?.kind==='retained'||figure?.kind==='panels'&&figure.panels?.some(panel=>panel.figure?.kind==='retained')===true;
export const hasRetainedFigures=record=>record?.figures?.some(hasRetainedFigure)===true;
export async function retainedFigureDocument(document,{signal}={}){
 signal?.throwIfAborted();
 if(!await document.tree.select(document.root,['figures']))return false;
 for await(const item of document.items(['figures'],{signal})){
  signal?.throwIfAborted();const kind=(await document.tree.selected(item.value,['kind'])).value;
  if(kind==='retained')return true;
  if(kind==='panels')for await(const panel of document.items(['figures',String(item.index),'panels'],{signal})){
   signal?.throwIfAborted();if((await document.tree.selected(panel.value,['figure','kind'])).value==='retained')return true;
  }
 }
 return false;
}
