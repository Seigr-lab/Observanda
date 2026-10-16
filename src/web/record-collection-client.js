import {viewQuery} from './record-view-model.js';
import {researchId} from './research-reference.js';
export const collectionRecords=state=>Boolean(state.workspaceOutline&&!state.projectOwner?.labBookId&&(!state.notebook||state.notebook==='all'));
export const recordCollectionRoute=state=>'/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'')+'record-collection/query';
export const recordCollectionCommand=(state,{mode='browse',limit=25,cursor=null,projectId}={})=>({workspaceId:state.book.id,query:viewQuery(projectId?{project:projectId}:state),mode,limit,cursor});
export const validRecordOwner=value=>value&&researchId(value.workspaceId)&&(value.projectId===null||researchId(value.projectId))&&(value.labBookId===null||researchId(value.labBookId))&&typeof value.projectTitle==='string'&&typeof value.notebookTitle==='string';
export const collectionAccessError=error=>['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error?.code);
