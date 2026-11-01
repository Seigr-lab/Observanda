import {withoutCatalogueContext} from './catalogue-context.js';
import {withoutCatalogueConnections} from './catalogue-connections.js';
import {withoutCatalogueInspection} from './catalogue-inspection.js';
import {withoutDatabaseScope} from './workspace-database-context.js';
import {withoutCatalogueReadContext} from './storage.js';
import {withoutMetadataBatch} from './metadata-batch.js';
// Only durable filesystem helper resources and expiry timers leave the source
// request. Query production still runs inside its original authenticated read.
export const detachedQueryCache=operation=>withoutCatalogueContext(()=>withoutCatalogueConnections(()=>withoutCatalogueInspection(()=>withoutDatabaseScope(()=>withoutCatalogueReadContext(()=>withoutMetadataBatch(operation))))));
