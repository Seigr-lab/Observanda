import {LabBookDirectory} from '../src/lab-book-directory.js';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
export async function moduleDashboardFixture(t){
 const f=await projectTreeFixture(t),workspaceId=(await f.workspace.outline()).metadata.id,calendarId=randomUUID(),eventId=randomUUID(),resourceId=randomUUID();
 for(const book of f.books)await new LabBookDirectory(f.registry).register(book.projectId,book);
 const owners=[{storage:f.workspace,workspaceId,projectId:null,labBookId:null},...f.projects.map(p=>({storage:new ProjectStorage(p.root,p.projectId,p.key),workspaceId:p.namespaceId,projectId:p.projectId,labBookId:null})),...f.books.map(b=>({storage:new LabBookStorage(b.root,b.labBookId,b.key),workspaceId:b.namespaceId,projectId:b.projectId,labBookId:b.labBookId}))];
 for(const [index,owner] of owners.entries()){
  const commands=new ProjectModuleCommands(owner.storage,owner.workspaceId);await commands.initialize();owner.command=(action,payload)=>commands.execute({workspaceId:owner.workspaceId,commandId:randomUUID(),action,payload});
  owner.calendar={name:'Calendar '+index,projectId:null,color:'#123456',archived:false};
  await owner.command('calendar.save',{id:calendarId,expectedRevision:null,data:owner.calendar});
  await owner.command('event.save',{id:eventId,expectedRevision:null,data:{title:'Shared event identity',calendarId,startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,timeZone:'UTC',location:'Location '+index,notes:'Independent event '+index,status:'confirmed'}});
  await owner.command('resource.create',{id:resourceId,data:{projectId:null,placementId:null,name:'Shared resource identity',code:resourceId,kind:'material',description:'Independent resource '+index,categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:String(index+1),projectId:null}});
 }
 return {...f,workspaceId,owners,calendarId,eventId,resourceId};
}
