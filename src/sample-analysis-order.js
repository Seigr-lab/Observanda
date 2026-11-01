import {AppError} from './errors.js';

// Extend the original five-digit range without changing any retained index key.
// The second range follows every decimal key and orders all safe integers exactly.
export function sampleAnalysisOrder(position){
 if(!Number.isSafeInteger(position)||position<0)throw new AppError('LAB_INVALID');
 return position<100000?String(position).padStart(5,'0'):'~'+String(position).padStart(16,'0');
}
