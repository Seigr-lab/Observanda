// Policy admission travels with immutable graphs, retained recipes and queued commands.
export const datasetResourceMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===5||value?.content?.calculation?.version===8;
export const datasetResourceMetadata=(relative,value)=>datasetResourceMaterial(value)||relative.startsWith('.observanda/jobs/')&&value?.input?.command?.calculation?.version===8;
