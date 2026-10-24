import {validateCoordinateFrameColumn} from './coordinate-frame-transform.js';
// The column owns this immutable interpretation through its normal metadata
// resource edges. It does not depend on reading a private model during export.
export async function retainCoordinateFrameSchema(materials,column,options={}){
 await validateCoordinateFrameColumn(materials,column,options);
 if(column.coordinateFrame.axesIndex)return column;
 const frame=await materials.read(column.coordinateFrame.frame);options.signal?.throwIfAborted();
 return {...column,coordinateFrame:{...column.coordinateFrame,axesIndex:structuredClone(frame.content.axesIndex)}};
}
