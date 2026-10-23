// Capability detection reads compact figure kinds, never point collections.
export const hasRetainedFigure=figure=>figure?.kind==='retained';
export const hasRetainedFigures=record=>record?.figures?.some(hasRetainedFigure)===true;
export async function retainedFigureDocument(document,{signal}={}){
 if(!await document.tree.select(document.root,['figures']))return false;
 for await(const item of document.items(['figures'],{signal})){signal?.throwIfAborted();if((await document.tree.selected(item.value,['kind'])).value==='retained')return true;}
 return false;
}
