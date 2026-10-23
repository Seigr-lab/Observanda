// Inspect only authored figure interpretation, never arbitrary record text.
export const hasApproximateFigure=figure=>figure?.computation!==undefined||figure?.kind==='panels'&&figure.panels?.some(panel=>hasApproximateFigure(panel.figure))===true;
export const hasApproximateFigures=record=>record?.figures?.some(hasApproximateFigure)===true;
export async function approximateFigureDocument(document,{signal}={}){
 if(!await document.reference(['figures']))return false;
 async function visit(path){
  signal?.throwIfAborted();if((await document.field([...path,'computation'])).found)return true;
  if((await document.field([...path,'kind'])).value==='panels')for await(const panel of document.items([...path,'panels'],{signal}))if(await visit([...path,'panels',String(panel.index),'figure']))return true;
  return false;
 }
 for await(const figure of document.items(['figures'],{signal}))if(await visit(['figures',String(figure.index)]))return true;
 return false;
}
