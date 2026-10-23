import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {figureIssues} from './web/figure-model.js';
import {allFigurePlots,figureSourceEntries,validFigureSource} from './web/figure-provenance.js';
import {sameFigureCalculation} from './web/figure-result-links.js';

export async function validateFigureSources(workspace,record){
 const materials=new ResearchMaterials(workspace);
 for(const figure of allFigurePlots(record.figures))if(figure.kind==='retained'){const {validateRetainedFigureSource}=await import('./retained-figures.js');await validateRetainedFigureSource(materials,figure,{verify:true});}
 for(const {ref} of figureSourceEntries(record.figures)){
  if(!validFigureSource(ref))throw new AppError('ANALYSIS_INVALID');
  if(!(await materials.read(ref)).content.figure)throw new AppError('ANALYSIS_INVALID');
 }
}

// Older figures were linked implicitly by their original ID. Resolve the exact
// retained calculation before copying, never by a title or newer calculation.
export async function resolveFigureSources(materials,{recordId,figures},{signal}={}){
 signal?.throwIfAborted();
 if(!Array.isArray(figures)||figures.length>64||figures.some(f=>figureIssues(f,{draft:true}).length))throw new AppError('ANALYSIS_INVALID');
 return materials.readSnapshot(async()=>{
  await materials.assertOwner(recordId);
  const plots=allFigurePlots(figures),found=new Map();
  for(const f of plots)if(f.source){
   signal?.throwIfAborted();
   if(!validFigureSource(f.source)||!(await materials.read(f.source)).content.figure)throw new AppError('ANALYSIS_INVALID');
   found.set(f.id,f.source);
  }
  let cursor=null;
  do{
   signal?.throwIfAborted();
   const page=await materials.list({recordId,kind:'analysis',cursor});cursor=page.next;
   for(const head of page.items){
    const f=plots.find(f=>f.id===head.figureId&&!found.has(f.id));if(!f)continue;
    let ref={kind:'analysis',id:head.id,revision:head.revision};
    for(;;){
     signal?.throwIfAborted();
     const doc=await materials.read(ref);
     if(doc.content.figure&&sameFigureCalculation(f,doc.content.figure)){found.set(f.id,ref);break;}
     if(!doc.previous)break;ref={...ref,revision:doc.previous};
    }
   }
  }while(cursor&&found.size<plots.length);
  return {sources:[...found].map(([figureId,ref])=>({figureId,ref}))};
 });
}
