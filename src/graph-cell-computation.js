import {resolveCellComputation,derivedCellComputation,hasApproximateComputation} from './web/measurement-computation.js';
// Columns describe possible provenance; only these consumed values decide the
// current result. An unselected choose branch never contributes approximation.
export function graphCellComputation(node,cell,dependencies,column){
 if(node.kind==='column')return {computation:resolveCellComputation(column,cell)};
 if(node.kind==='constant')return {computation:null};
 if(!dependencies.length)return {computation:resolveCellComputation(column,cell)};
 if(node.operation==='choose'){
  const condition=dependencies[2];if(['absent','null'].includes(condition.kind))return derivedCellComputation(condition);
  const selected=dependencies[condition.value==='1'?0:1];
  return node.kind==='scalar'||hasApproximateComputation(condition)?derivedCellComputation(selected,condition):{computation:selected.computation??null};
 }
 if(node.kind==='scalar'&&node.operation==='copy')return derivedCellComputation(dependencies[0]);
 if(node.operation==='copy'||['domain-reshape','domain-permute'].includes(node.kind))return {computation:dependencies[0].computation??null};
 return derivedCellComputation(...dependencies,cell);
}
