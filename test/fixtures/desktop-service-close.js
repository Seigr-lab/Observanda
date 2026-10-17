import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {WorkspacePostgres} from '../../src/workspace-postgres.js';

// Reject one selected shutdown before the real database close begins.
// Application and nested-owner cleanup must still drain every live runtime.
let failClose=false,failRuntimeRoot=null;
process.on('message',message=>{
 if(message?.type!=='inject-close-failure')return;
 if(message.owner==='workspace')failClose=true;else failRuntimeRoot=message.root;
});
const closeRuntime=WorkspacePostgres.prototype.closeWorkspace;
WorkspacePostgres.prototype.closeWorkspace=async function(root){
 if(root===failRuntimeRoot){failRuntimeRoot=null;throw Error('Injected owned runtime shutdown failure');}
 return closeRuntime.call(this,root);
};
const closeWorkspace=WorkspaceDatabases.prototype.closeWorkspace;
WorkspaceDatabases.prototype.closeWorkspace=async function(root){
 if(failClose){failClose=false;throw Error('Injected desktop shutdown failure');}
 return closeWorkspace.call(this,root);
};
await import('../../src/desktop-service.js');
process.send({type:'fixture-ready'});
