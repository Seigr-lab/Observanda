// Inspect only admitted metadata shapes, never arbitrary authored source text.
const column=value=>value?.representation==='domain';
export function nativeDomainCommand(command){return !!command&&(command.calculation?.version===5||command.aggregation?.version===2||Array.isArray(command.columns)&&command.columns.some(column)||Array.isArray(command.columnChanges)&&command.columnChanges.some(change=>column(change.column)));}
export function nativeDomainMaterial(value){const c=value?.content;return !!c&&(c.domainValues===1||c.graphVersion===2&&c.tool==='Observanda calculation graph'||c.calculation?.version===5||c.aggregation?.version===2||Array.isArray(c.columns)&&c.columns.some(column));}
export function nativeDomainMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/')&&['dataset.prepare','figure.calculate'].includes(value?.type))return nativeDomainCommand(value.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/'))return value?.kind==='domain-components'||value?.kind==='columns'&&value.items?.some(column)||value?.kind==='cells'&&value.items?.some(cell=>cell.value?.format==='domain-value')||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain')||value?.kind==='calculation-edges'&&value.items?.some(edge=>edge.semantics==='domain');
 return nativeDomainMaterial(value);
}
