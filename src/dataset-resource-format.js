// Policy admission travels with immutable graphs, retained recipes and queued commands.
export const datasetResourceMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion>=5||[8,9,10,11,12,13].includes(value?.content?.calculation?.version);
export const datasetResourceMetadata=(relative,value)=>datasetResourceMaterial(value)||relative.startsWith('.observanda/jobs/')&&[8,9,10,11,12,13].includes(value?.input?.command?.calculation?.version);
