// Row-window semantics are pinned in graphs, results and recoverable queued commands.
export const windowCalculationMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===6||value?.content?.calculation?.version===9;
export const windowCalculationMetadata=(relative,value)=>windowCalculationMaterial(value)||relative.startsWith('.observanda/jobs/')&&value?.input?.command?.calculation?.version===9||relative.startsWith('.observanda/materials/sequences/chunks/')&&value?.kind==='calculation-lineage'&&value.items?.some(item=>item.window);
