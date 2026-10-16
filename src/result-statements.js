import {ResearchMaterials} from './research-materials.js';
import {AppError} from './errors.js';
import {validResults,resultReferences} from './web/result-statements.js';
import {figureTargets} from './web/figure-composition.js';
import {retainedTable} from './retained-tables.js';
import {revisionText} from './web/revision-model.js';
export async function validateResultSources(workspace,record){
 if(record.results===undefined)return;const targets=new Set(figureTargets(record.figures).map(f=>f.id));if(!validResults(record.results)||record.results.statements.some(s=>s.kind==='figure'&&!targets.has(s.figureId)))throw new AppError('ANALYSIS_INVALID');
 const materials=new ResearchMaterials(workspace);for(const ref of resultReferences(record.results))await materials.read(ref);
 for(const s of record.results.statements)if(s.table){const expected=await retainedTable(materials,{ref:s.source,selection:s.table.selection,version:s.table.version});if(revisionText(expected)!==revisionText(s.table))throw new AppError('DATASET_TABLE');}
}
