// Only known bounded metadata shapes are inspected. Scientific source text and
// arbitrary authored objects are never recursively searched for format markers.
const typedColumn=column=>column?.quantity?.unitDefinition!==undefined;
export function nativeNumericalCommand(command){
 return !!command&&(command.calculation?.version===3||command.measurement?.quantity?.unitDefinition!==undefined||command.mapping?.projection!==undefined||
  Array.isArray(command.columns)&&command.columns.some(typedColumn)||Array.isArray(command.columnChanges)&&command.columnChanges.some(change=>typedColumn(change.column)));
}
export function nativeNumericalMaterial(value){
 const content=value?.content;
 return !!content&&(content.calculation?.version===3||content.measurement?.quantity?.unitDefinition!==undefined||Array.isArray(content.columns)&&content.columns.some(typedColumn)||content.tool==='Observanda table mapping'&&content.version==='8');
}
export function nativeNumericalMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/')&&['dataset.prepare','figure.calculate'].includes(value?.type))return nativeNumericalCommand(value.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/')&&value?.kind==='columns')return Array.isArray(value.items)&&value.items.some(typedColumn);
 return nativeNumericalMaterial(value);
}
