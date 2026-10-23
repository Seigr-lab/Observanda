// Inspect capability fields without reconstructing heavy point arrays.
export const hasFigureProjection=figure=>!!figure&&(Object.hasOwn(figure,'projection')||figure.kind==='panels'&&figure.panels.some(panel=>Object.hasOwn(panel.figure,'projection')));
export const hasRecordProjection=record=>record?.figures?.some(hasFigureProjection)===true;
export async function projectedFigureDocument(document,{signal}={}){
 if(!await document.tree.select(document.root,['figures']))return false;
 for await(const item of document.items(['figures'],{signal})){
  if((await document.tree.selected(item.value,['projection'])).found)return true;
  if((await document.tree.selected(item.value,['kind'])).value!=='panels')continue;
  const count=await document.tree.arrayLength(item.value,['panels']);
  for(let index=0;index<count;index++){signal?.throwIfAborted();if((await document.tree.selected(item.value,['panels',String(index),'figure','projection'])).found)return true;}
 }
 return false;
}
