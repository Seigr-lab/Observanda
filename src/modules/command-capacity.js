import {AppError} from '../errors.js';
import {serialize} from '../storage-format.js';
import {moduleEntityBytes} from './catalogue.js';
import {MODULE_BYTES} from './capacity.js';
export function admitModuleChanges(entities,event){
 for(const entity of entities)if(moduleEntityBytes(entity)>MODULE_BYTES)throw new AppError('LIMIT');
 if(Buffer.byteLength(serialize(event))>MODULE_BYTES)throw new AppError('LIMIT');
}
