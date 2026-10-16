import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {dashboardSelection} from './web/dashboard-scope.js';
import {dashboardSourceIdentity} from './web/dashboard-source-key.js';
const types={planning:['task','calendar','event','booking'],inventory:['resource','category','movement','reservation','stock-transfer','asset-transfer','bom']};
export function moduleDashboardContract(command){
 if(!command||Object.keys(command).sort().join()!=='area,config,cursor,key,keys,limit,mode,offset,options,type,workspaceId')throw new AppError('INVALID');
 const {workspaceId,area,type,config,options,mode,limit,offset,cursor,key,keys}=command,source=dashboardSourceIdentity(key);
 if(!researchId(workspaceId)||!types[area]?.includes(type)||!['page','choices','discovery','labels'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(offset)||offset<0||mode!=='discovery'&&offset!==0||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096)||!source||source.key&&!researchId(source.key))throw new AppError('INVALID');
 if(keys!==null&&(!Array.isArray(keys)||keys.length>25||new Set(keys).size!==keys.length||keys.some(key=>!dashboardSourceIdentity(key)?.key||!researchId(dashboardSourceIdentity(key).key)))||mode==='labels'&&keys===null||mode!=='labels'&&keys!==null)throw new AppError('INVALID');
 const settings=defaultDashboard();settings.views[0].panels=[{...createPanel('records','query'),config,options}];if(!validDashboard(settings))throw new AppError('INVALID');
 if(config.workspaceId&&config.workspaceId!==workspaceId)throw new AppError('RECORD_VIEW_SCOPE');
 if(typeof (options.search??'')!=='string'||(options.search??'').length>256||typeof (options.status??'')!=='string'||(options.status??'').length>80||options.kind&&!['object','material','equipment','software'].includes(options.kind))throw new AppError('INVALID');
 const selected=type==='resource'&&options.resourceMode==='selected'?options.resourceIds??[]:null;
 if(selected&&(!Array.isArray(selected)||selected.some(key=>!researchId(dashboardSourceIdentity(key)?.key))))throw new AppError('INVALID');
 const canonical=key=>{const source=dashboardSourceIdentity(key);return (source.workspaceId??workspaceId)+'/'+source.key;};
 if([keys,selected].some(values=>values&&new Set(values.map(canonical)).size!==values.length))throw new AppError('INVALID');
 const oldBook=options.notebookId??config.notebookId,selection={...dashboardSelection(options,config),notebookMode:options.notebookMode??(oldBook?'selected':'all'),notebookIds:options.notebookIds??(oldBook?[oldBook]:[])};
 return {source,selection,selected};
}
