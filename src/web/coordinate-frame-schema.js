import {validCoordinateFrameDescriptor,COORDINATE_FRAME_METHOD} from './coordinate-frame-model.js';
import {knownDomain,domainCodec,validDomainDefinition} from './measurement-domain-model.js';
import {validUnitDefinition} from './measurement-unit-model.js';
export function validColumnCoordinateFrame(column){
 if(column?.coordinateFrame===undefined)return true;
 return validCoordinateFrameDescriptor(column.coordinateFrame)&&column.representation==='domain'&&validDomainDefinition(column.domain)&&knownDomain(column.domain)&&domainCodec(column.domain)==='vector'&&column.quantity?.unitDefinition?.kind==='difference'&&validUnitDefinition(column.quantity.unitDefinition);
}
// Renaming a calculated column cannot rewrite the transform which produced it.
// A source frame assignment may be corrected in a new authored schema revision.
export function preserveCoordinateFrameResult(original,edited){
 if(!original?.coordinateFrame?.transform)return edited;
 const result={...edited};for(const key of ['coordinateFrame','representation','domain','radix','unit','quantity'])if(original[key]===undefined)delete result[key];else result[key]=structuredClone(original[key]);return result;
}
// Public tables disclose the result's declared coordinate meaning, never the
// private frame/model references or labels of unselected source documents.
export function publicCoordinateFrameContext(column){
 if(!column?.coordinateFrame||!validColumnCoordinateFrame(column))return undefined;
 return {namespace:column.domain.namespace,dimension:column.domain.shape[0],unit:column.unit,...(column.coordinateFrame.transform?{method:COORDINATE_FRAME_METHOD}:{})};
}
