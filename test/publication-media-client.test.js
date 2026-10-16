import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {publicationMediaClient} from '../src/web/publication-media-client.js';

test('media selection traverses independent sources and cannot adopt private or substituted media',async()=>{
 const sources=[0,1].map(()=>({workspaceId:id(),projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}})),state={page:'website',websiteId:id(),book:{id:id(),notebooks:[],website:{researchSources:sources}},etag:'a'.repeat(64),storage:{contextId:'host'}};
 const lists=sources.map((source,index)=>Array.from({length:index?1:13},()=>{const entryId=id(),asset={id:id(),kind:'image',caption:'Selected image',alt:'Image description',share:true};return {owner:{workspaceId:source.workspaceId,projectId:id(),labBookId:id()},key:entryId+':'+asset.id,entryId,asset,sourceAttachmentId:id(),record:{id:entryId,title:'Observation',notebookId:id()},label:'Observation / Selected image'};}));
 const api=async(route,command,options)=>{assert.equal(command.operation,'source-media');assert.equal(options.adopt,false);const index=sources.findIndex(source=>source.workspaceId===command.sourceId),offset=Number(command.query.cursor??0),rows=lists[index];return {owner:{workspaceId:command.sourceId},value:{workspaceId:command.sourceId,snapshotId:String(index+1).repeat(64),items:rows.slice(offset,offset+12),previousCursor:offset?'0':null,nextCursor:offset+12<rows.length?String(offset+12):null}};};
 const research={query(){throw Error('Unrelated host queried');}},query=publicationMediaClient({state,api,research}),first=await query(),second=await query({cursor:first.nextCursor}),third=await query({cursor:second.nextCursor});assert.equal(first.items.length,12);assert.equal(second.items.length,1);assert.equal(third.items[0].owner.workspaceId,sources[1].workspaceId);assert.deepEqual((await query({cursor:third.previousCursor})).items,second.items);
 await assert.rejects(publicationMediaClient({state,research,api:async(...args)=>{const response=await api(...args);response.value.items[0]={...response.value.items[0],asset:{...response.value.items[0].asset,share:false}};return response;}})());
 state.websiteId=id();await assert.rejects(query({cursor:second.nextCursor}));
});
