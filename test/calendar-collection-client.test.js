import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../src/storage-format.js';
import {createDataRegistry} from '../src/web/data-registry.js';
import {registerCombinedCalendar} from '../src/web/modules/calendar-data.js';

test('combined calendar cards retain legacy pins and reject another owner behind a pinned key',async()=>{
 const workspaceId=randomUUID(),sourceId=randomUUID(),eventId=randomUUID(),owner={workspaceId,projectId:null,labBookId:null,projectTitle:'',notebookTitle:''};
 const event={id:eventId,sourceId,title:'Scheduled observation',startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,type:'event',projectId:null,owner,source:{id:sourceId,name:'Observations',owner:'Workspace'},collectionKey:workspaceId+'/'+digest(JSON.stringify([sourceId,eventId]))};
 const result={workspaceId,collection:true,events:[event],total:1,offset:0,sourceErrors:[],cursor:'page',nextCursor:null,previousCursor:null},registry=createDataRegistry();registerCombinedCalendar(registry);const provider=registry.get('calendar-agenda');
 for(const key of [null,event.collectionKey,sourceId+':'+eventId]){
  const context={book:{id:workspaceId},outline:true,recordKey:key},reply=await provider.load({api:async route=>{assert.equal(route,'/api/projects/dashboard-collection/calendar');return result;},context});
  const [item]=provider.items(context,reply);assert.equal(item.key,key??event.collectionKey);assert.equal(item.action.name,'module-open-owned');assert.equal(item.action.data.workspaceId,workspaceId);assert.equal(item.action.data.modulePath,'scope/workspace/event/'+eventId);
 }
 const context={book:{id:workspaceId},outline:true,recordKey:event.collectionKey},other=randomUUID();
 await assert.rejects(provider.load({api:async()=>({...result,events:[{...event,owner:{...owner,workspaceId:other},collectionKey:other+'/'+event.collectionKey.split('/')[1]}]}),context}));
});
