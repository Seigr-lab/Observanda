import {AppError} from './errors.js';

const libraryUnit=value=>value?.source?.catalogue==='observanda-units';
const quantity=value=>value?.unitSource!==undefined||value?.calibrationReview!==undefined||libraryUnit(value?.unitDefinition);
const clock=value=>libraryUnit(value?.rate?.unitDefinition);
const item=value=>!!value&&(quantity(value.quantity)||quantity(value.value?.quantity)||clock(value.time?.clock?.definition)||
 libraryUnit(value.unitDefinition)||libraryUnit(value.toleranceUnit)||libraryUnit(value.match?.coordinate?.toleranceUnit)||
 libraryUnit(value.sampling?.unitDefinition)||libraryUnit(value.frequencyGrid?.unitDefinition)||
 libraryUnit(value.coordinateUnit?.definition)||libraryUnit(value.sensitivity?.unitDefinition)||libraryUnit(value.value?.unitDefinition));

function declaration(value){
 return !!value&&(item(value)||item(value.measurement)||item(value.spectrum)||item(value.cusum)||item(value.target)||
  item(value.weightedFit)||item(value.coordinateAlignment)||item(value.item)||item(value.result?.nominal)||
  item(value.result?.variance)||item(value.result?.standardUncertainty)||value.columns?.some?.(item)||
  value.columnChanges?.some?.(change=>item(change?.column))||value.calculation?.steps?.some?.(item));
}

export const scientificUnitMaterial=value=>!!value?.content&&(value.content.scientificUnitLibrary===1||
 ['Observanda unit definition','Observanda calibration coverage'].includes(value.content.tool)||declaration(value.content));
export const scientificColumnUsesLibrary=item;

export function scientificUnitMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return declaration(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/index/unit-definitions/')||relative.startsWith('.observanda/materials/index/calibrations/'))return true;
 if(relative.startsWith('.observanda/materials/sequences/chunks/')){
  return ['columns','columns-policy','calculation-nodes','calculation-bindings','uncertainty-inputs','uncertainty-covariance'].includes(value?.kind)&&Array.isArray(value.items)&&value.items.some(item);
 }
 return scientificUnitMaterial(value);
}

export async function assertScientificUnitFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 const {catalogueFormat,catalogueRequiresScientificUnitLibrary,catalogueRequiresNativeNumericalModels}=await import('./catalogue-format.js');
 await workspace.catalogue(async store=>{
  const format=await catalogueFormat(store.catalogueDb??store.db);
  if(!catalogueRequiresScientificUnitLibrary(format)||!catalogueRequiresNativeNumericalModels(format))throw new AppError('CATALOGUE_DAMAGED');
 });
}
