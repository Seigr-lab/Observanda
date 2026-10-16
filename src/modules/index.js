import {bomDefinitions} from './bom.js';
import {toolDefinitions} from './tools.js';
import {ModuleStore} from './store.js';
import {resourceDefinitions} from './resources.js';
import {planningDefinitions} from './planning.js';
import {laboratoryDefinitions} from './laboratory.js';
import {calendarDefinitions} from './calendars.js';
const modules=[toolDefinitions,resourceDefinitions,bomDefinitions,planningDefinitions,calendarDefinitions,laboratoryDefinitions];
const definitions={types:{},commands:{},validate:[],sourceValidators:[]};
for(const module of modules){
 for(const kind of ['types','commands'])for(const [key,value] of Object.entries(module[kind])){
  if(Object.hasOwn(definitions[kind],key))throw new Error('Duplicate module registration: '+key);
  definitions[kind][key]=value;
 }
 definitions.validate.push(...module.validate);
 if(module.validateSource)definitions.sourceValidators.push({accepts:module.constraintTypes,validate:module.validateSource});
}
export const workspaceModules=workspace=>new ModuleStore(workspace,definitions);
