import {ModuleReader} from './modules/reader.js';
import {MAX_BYTES} from './model.js';
// A selected owner's module summaries are read without authoring or materializing
// another owner's module history. Domain mutations have separate command owners.
export function moduleReadRequest(route){
 const method={'/api/modules/items':'list','/api/modules/item':'selected','/api/modules/labels':'labels'}[route];
 return method?{write:false,limit:MAX_BYTES,run:(storage,data,options)=>new ModuleReader(storage)[method](data,options)}:null;
}
