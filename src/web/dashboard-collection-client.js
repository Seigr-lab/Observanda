import {validRecordOwner} from './record-collection-client.js';
import {dashboardSourceKey} from './dashboard-source-key.js';
export const dashboardCollection=context=>Boolean(context.outline&&!context.projectOwner?.labBookId);
export const dashboardCollectionRoute=(context,operation)=>'/api/projects/'+(context.projectOwner?.projectId?context.projectOwner.projectId+'/':'')+'dashboard-collection/'+operation;
export const dashboardRecordIdentity=record=>record.collectionKey??record.id;
export const dashboardRecordAction=record=>record.owner?{name:'research-open-owned',data:{workspaceId:record.owner.workspaceId,id:record.id}}:{name:'edit-entry',id:record.id};
export function dashboardRecordData(record){const {owner,collectionKey,...data}=record;return data;}
export const validDashboardOwner=(item,key)=>validRecordOwner(item.owner)&&key.startsWith(item.owner.workspaceId+'/');
export const dashboardPinnedItem=(item,key,workspaceId)=>item.key===key||!key.includes('/')&&item.key===dashboardSourceKey(workspaceId,key);
