import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
export const validFigureSource=value=>value&&Object.keys(value).sort().join()==='id,kind,revision'&&value.kind==='analysis'&&researchId(value.id)&&revisionId(value.revision);
export const allFigurePlots=(figures=[])=>figures.flatMap(f=>[f,...(f.kind==='panels'?f.panels.map(p=>p.figure):[])]);
export const figureSourceEntries=figures=>allFigurePlots(figures).filter(f=>f.source).map(f=>({figure:f,ref:f.source}));
export const figureReferences=figures=>figureSourceEntries(figures).map(({ref})=>ref);
export function withoutFigureSources(figure){
 const copy=structuredClone(figure);delete copy.source;
 if(copy.kind==='panels')copy.panels=copy.panels.map(p=>({...p,figure:withoutFigureSources(p.figure)}));
 return copy;
}
export const withFigureSource=(figure,ref)=>({...structuredClone(figure),source:{kind:'analysis',id:ref.id,revision:ref.revision}});
