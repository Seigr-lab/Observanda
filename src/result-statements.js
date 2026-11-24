import {ResearchMaterials} from './research-materials.js';
import {AppError} from './errors.js';
import {validResults,resultReferences} from './web/result-statements.js';
import {hasRetainedFigureTarget} from './retained-figure-targets.js';
import {retainedTableSource} from './retained-tables.js';
export async function validateResultSources(workspace,record,{signal}={}){
 if(record.results===undefined)return;if(!validResults(record.results))throw new AppError('ANALYSIS_INVALID');
 for(const statement of record.results.statements){
  signal?.throwIfAborted();if(statement.kind!=='figure')continue;let found=false;
  for(const figure of record.figures??[]){if(await hasRetainedFigureTarget(workspace,figure,statement.figureId,{signal})){found=true;break;}}
  if(!found)throw new AppError('ANALYSIS_INVALID');
 }
 const materials=new ResearchMaterials(workspace);for(const ref of resultReferences(record.results))await materials.read(ref);
 // A table is its query over the pinned dataset revision; it must still resolve there.
 for(const s of record.results.statements)if(s.table)await retainedTableSource(materials,s.source,s.table.selection);
}
