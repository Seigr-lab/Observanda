import {AppError} from './errors.js';
export const hasStructuredCalculator=(type,data)=>type==='calculation'&&data?.engine===4;
export const checkpointHasStructuredCalculator=value=>Array.isArray(value?.drafts)&&value.drafts.some(d=>hasStructuredCalculator(d?.type,d?.data)||hasStructuredCalculator(d?.type,d?.base)||hasStructuredCalculator(d?.type,d?.operation?.values)||hasStructuredCalculator(d?.type,d?.operation?.base));
export const structuredCalculatorMaterial=value=>value?.content?.recipe?.version===2&&value.content.tool==='Observanda calculator recipe'||value?.content?.calculatorResult?.version===2;
export const structuredCalculatorMetadata=(relative,value)=>structuredCalculatorMaterial(value)||relative.startsWith('.observanda/jobs/')&&value?.input?.command?.calculatorResult?.version===2;
export async function assertStructuredCalculatorFormat(workspace){await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresStructuredCalculator}=await import('./catalogue-format.js');if(!catalogueRequiresStructuredCalculator(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
