import {validatedExchangeFrames} from '../src/dataset-exchange-reader.js';
// Reads a typed dataset exchange through the product validator: every frame
// except the completion receipt is handed to stage, and the receipt is returned.
export async function readDatasetExchange(chunks,stage,options){
 let receipt;
 for await(const frame of validatedExchangeFrames(chunks,options)){
  if(frame.type==='complete')receipt=frame;else await stage(frame);
 }
 return receipt;
}
