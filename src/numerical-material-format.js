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
 if(relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind))return Array.isArray(value.items)&&value.items.some(typedColumn);
 return nativeNumericalMaterial(value);
}

const clockColumn=column=>column?.time?.clock?.definition!==undefined;
export function nativeClockCommand(command){
 return !!command&&(clockColumn(command.measurement)||Array.isArray(command.columns)&&command.columns.some(clockColumn)||Array.isArray(command.columnChanges)&&command.columnChanges.some(change=>clockColumn(change.column)));
}
export function nativeClockMaterial(value){
 const content=value?.content;return !!content&&(clockColumn(content.measurement)||Array.isArray(content.columns)&&content.columns.some(clockColumn));
}
export function nativeClockMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/')&&value?.type==='dataset.prepare')return nativeClockCommand(value.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind))return Array.isArray(value.items)&&value.items.some(clockColumn);
 return nativeClockMaterial(value);
}
