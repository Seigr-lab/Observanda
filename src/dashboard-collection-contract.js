import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {dashboardSelection} from './web/dashboard-scope.js';
import {researchCardFields} from './web/research-card-items.js';
import {labRecordProvider} from './web/laboratory/data-scope.js';
import {dashboardSourceIdentity} from './web/dashboard-source-key.js';
import {STATUSES} from './web/record-types.js';
import {validViewFilter} from './web/record-view-model.js';
export function dashboardCollectionContract(command){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,etag,key,limit,options,provider,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,config,options,provider,limit,cursor,key}=command,field=researchCardFields[provider],lab=labRecordProvider(provider),source=dashboardSourceIdentity(key);
 if(!researchId(workspaceId)||!revisionId(etag)||!Number.isInteger(limit)||limit<1||limit>100||!source||provider!=='records'&&!field&&!lab||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
 if(source.key&&source.key.split(':').length!==(!field||provider==='figures'?1:2))throw new AppError('INVALID');
 const settings=defaultDashboard();settings.views[0].panels=[{...createPanel('records','query'),config,options}];if(!validDashboard(settings))throw new AppError('INVALID');
 if(config.workspaceId&&config.workspaceId!==workspaceId)throw new AppError('RECORD_VIEW_SCOPE');
 const filters={...config,...options};if(!validViewFilter(filters.recordType)||filters.status!=='all'&&!STATUSES.includes(filters.status)||typeof filters.tag!=='string'||filters.tag.length>512)throw new AppError('INVALID');
 const oldBook=options.notebookId??config.notebookId;
 const selection={...dashboardSelection(options,config),notebookMode:options.notebookMode??(oldBook?'selected':'all'),notebookIds:options.notebookIds??(oldBook?[oldBook]:[])};
 return {field,lab,source,selection,filters};
}
