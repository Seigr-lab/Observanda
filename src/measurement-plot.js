import {AppError} from './errors.js';
import {exactRational} from './web/measurement-model.js';
import {rationalProjection,safeRationalProjection} from './web/measurement-projection.js';
// Explicitly approximate display projection. The input spelling and radix stay
// in the pinned dataset; a coordinate is never saved back as a source value.
export function plotCoordinate(raw,column,policy='safe'){
 const fail=()=>{throw new AppError('MATERIAL_PRECISION');};
 if(!['safe','approximate'].includes(policy))fail();
 try{
  const exact=exactRational(raw,column.representation,column.radix);
  return String(policy==='safe'?safeRationalProjection(exact):rationalProjection(exact));
 }catch{fail();}
}
