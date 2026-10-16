// Deterministic operation identities use the module UUID admission shape.
import {createHash} from 'node:crypto';
export function inventoryPhaseId(operationId,namespaceId,phase){const h=createHash('sha256').update(JSON.stringify(['Observanda/inventory-operation/v1',operationId,namespaceId,phase])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
