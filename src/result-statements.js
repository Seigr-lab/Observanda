import {ResearchMaterials} from './research-materials.js';
import {AppError} from './errors.js';
import {validResults,resultReferences} from './web/result-statements.js';
import {hasRetainedFigureTarget} from './retained-figure-targets.js';
import {retainedTable} from './retained-tables.js';
import {revisionText} from './web/revision-model.js';
export async function validateResultSources(workspace,record,{signal}={}){
 if(record.results===undefined)return;if(!validResults(record.results))throw new AppError('ANALYSIS_INVALID');
 for(const statement of record.results.statements){
  signal?.throwIfAborted();if(statement.kind!=='figure')continue;let found=false;
  for(const figure of record.figures??[]){if(await hasRetainedFigureTarget(workspace,figure,statement.figureId,{signal})){found=true;break;}}
  if(!found)throw new AppError('ANALYSIS_INVALID');
 }
 if(record.results.statements.some(statement=>statement.table?.version===3)&&await workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
 const materials=new ResearchMaterials(workspace);for(const ref of resultReferences(record.results))await materials.read(ref);
 for(const s of record.results.statements)if(s.table){const expected=await retainedTable(materials,{ref:s.source,selection:s.table.selection,version:s.table.version});if(revisionText(expected)!==revisionText(s.table))throw new AppError('DATASET_TABLE');}
}
