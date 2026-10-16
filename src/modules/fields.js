
import {requireValue} from './validation.js';
import {validFields,fieldValueErrors} from '../web/custom-fields.js';
export const schemaValid=validFields;
export function validateValues(fields,values){const errors=fieldValueErrors(fields,values);requireValue(!errors.length,errors[0]??'Custom fields');}
