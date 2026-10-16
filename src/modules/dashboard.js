import {AppError} from '../errors.js';
import {ModuleReader} from './reader.js';
import {ownerLabel,scopePath} from '../web/modules/scope.js';
import {projectUsesTool} from '../web/project-tools.js';
import {discoveryMatches} from '../web/data-discovery.js';
const types=['task','booking','calendar','event'];

// A card reads originals only for its current page. The title/search/ownership
// query runs on authenticated facts before any authored content is opened.
export class PlanningDashboard{
 constructor(workspace,{reader=new ModuleReader(workspace)}={}){this.reader=reader;}
 async page(command,{signal}={}){
  if(!types.includes(command.type))throw new AppError('INVALID');
  const page=await this.reader.list({...command,moduleId:'planning'},{signal});
  return this.reader.context(command.workspaceId,async c=>{
   if(c.head.revision!==page.revision)throw new AppError('MODULE_QUERY_CURSOR');
   const items=[];
   for(const summary of page.items){
    signal?.throwIfAborted();
    const entity=await c.selected(summary.id);if(!entity)throw new AppError('CATALOGUE_DAMAGED');
    this.reader.modules.validateEntity(entity);
    const member=await c.member(entity.id),facts=await c.references(member),parent=facts.ownerId&&await c.member(facts.ownerId);
    const projectId=parent?(await c.references(parent)).projectId:facts.projectId;
    const resource=entity.data.resourceId&&await c.member(entity.data.resourceId);
    items.push({key:entity.id,title:summary.title,data:{...entity.data,owner:ownerLabel(c.book,projectId),revision:entity.revision,updatedAt:entity.updatedAt,...(resource?{resource:(await c.view(resource)).title}:{})},
     action:{name:'module-open',data:{moduleId:'planning',modulePath:scopePath(projectId,entity.type+'/'+entity.id)}}});
   }
   return {...page,items};
  });
 }
 async discover({workspaceId,type,search='',offset=0,limit=12},{signal}={}){
  if(!types.includes(type)||typeof search!=='string'||search.length>256||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)throw new AppError('INVALID');
  return this.reader.context(workspaceId,async c=>{
   const items=[];let total=0;
   for await(const member of c.members({signal})){
    signal?.throwIfAborted();if(member.type&&member.type!==type)continue;
    const view=await c.view(member);if(view.type!==type)continue;
    const facts=await c.references(member),parent=facts.ownerId&&await c.member(facts.ownerId),projectId=parent?(await c.references(parent)).projectId:facts.projectId;
    if(!projectUsesTool(c.book,projectId,'planning'))continue;
    const item={key:member.id,title:view.title,subtitle:ownerLabel(c.book,projectId)};
    if(!discoveryMatches(item,search))continue;
    if(total++>=offset&&items.length<limit)items.push(item);
   }
   return {workspaceId,revision:c.head.revision,items,total,offset};
  });
 }
}
