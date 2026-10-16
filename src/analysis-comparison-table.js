// Preserve the retained comparison namespace and its strict branch format.
import {RetainedTableIndex} from './retained-table-index.js';
export {validTableRef} from './retained-table-index.js';
export class ComparisonTableIndex extends RetainedTableIndex{
 constructor(sequences){super(sequences,{namespace:'comparison-nodes'});}
}
