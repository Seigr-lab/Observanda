import {workspaceData} from './data-registry.js';
import {createModuleHost} from './feature-modules.js';
export const workspaceFeatures=createModuleHost(workspaceData);
export {workspaceData};
