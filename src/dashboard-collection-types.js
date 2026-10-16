import {AppError} from './errors.js';
import {recordCollectionTypes} from './record-collection-types.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
export async function dashboardCollectionTypes(pages,client,command,options){
 if(!command||Object.keys(command).sort().join()!=='config,cursor,etag,limit,options,search,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,config,options:settings,search,limit,cursor}=command;
 const {selection,filters}=dashboardCollectionContract({workspaceId,etag,config,options:settings,limit,cursor,key:null,provider:'records'});
 return recordCollectionTypes(pages,client,{workspaceId,etag,search,limit,cursor,selected:filters.recordType,projectId:null,notebookId:null},{...options,selection});
}
