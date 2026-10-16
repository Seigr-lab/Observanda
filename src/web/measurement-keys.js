import {exactRational} from './measurement-model.js';

export const KEY_SEMANTICS=['lexical','numeric'];
// Numerical equality is explicitly requested. Units must agree; this does not
// infer unit conversion or equivalence between clocks and physical domains.
export function numericalKey(raw,column){
 const {numerator,denominator}=exactRational(raw,column.representation,column.radix);
 return ['numeric',String(numerator),String(denominator),column.unit];
}
