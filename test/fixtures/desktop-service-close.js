import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {ProjectPostgres} from '../../src/project-postgres.js';
import {LabBookPostgres} from '../../src/lab-book-postgres.js';

// Reject one selected shutdown before the real database close begins: the whole
// workspace's, or a project's or lab book's role in the workspace cluster. The
// workspace cluster must still stop and every runtime drain.
let failClose=false,failOwner=null;
process.on('message',message=>{
 if(message?.type!=='inject-close-failure')return;
 if(message.owner==='workspace')failClose=true;else failOwner=message.owner;
});
for(const [kind,type] of [['project',ProjectPostgres],['book',LabBookPostgres]]){
 const closeHome=type.prototype.closeHome;
 type.prototype.closeHome=async function(home){
  if(failOwner===kind){failOwner=null;throw Error('Injected '+kind+' shutdown failure');}
  return closeHome.call(this,home);
 };
}
const closeWorkspace=WorkspaceDatabases.prototype.closeWorkspace;
WorkspaceDatabases.prototype.closeWorkspace=async function(root){
 if(failClose){failClose=false;throw Error('Injected desktop shutdown failure');}
 return closeWorkspace.call(this,root);
};
await import('../../src/desktop-service.js');
process.send({type:'fixture-ready'});
