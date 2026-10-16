import {OrganizationExchange} from './organization-exchange.js';
import {requireOrganization as valid} from './organization-state.js';
import {AppError} from '../errors.js';

export const organizationErrorStatus=Object.freeze({COLLABORATION_SIGNATURE:401,COLLABORATION_DENIED:403,COLLABORATION_EXPIRED:410,COLLABORATION_DAMAGED:500,COLLABORATION_LAST_ADMIN:409,COLLABORATION_ALREADY_MEMBER:409,COLLABORATION_INVITE_REQUIRED:409});

// These routes remain behind the local launch session and workspace lock.
// They are not an externally exposed multi-user authoring API.
export async function organizationCommand(workspace,device,operation,data){
  valid(data.workspaceId===(await workspace.outline()).metadata.id,'WORKSPACE_CHANGED');
  const exchange=new OrganizationExchange(workspace,device);
  if(operation==='state')return {...await exchange.state(),enrollments:await exchange.enrollments()};
  if(operation==='identity')return {identity:await exchange.identity.public()};
  if(operation==='invitation')return exchange.invitation(data.id);
  if(operation==='activity')return exchange.activity(data.organizationId,data.before??null);
  if(operation==='create')return exchange.organizations.create({workspaceId:data.workspaceId,name:data.name,administratorName:data.administratorName,expectedRevision:data.expectedRevision,identity:await exchange.identity.public()});
  if(operation==='command')return exchange.command(data.operation,data.payload,data.expectedRevision);
  if(operation==='inspect')return exchange.inspect(data.file);
  if(operation==='accept')return exchange.accept(data.file,data.verifiedFingerprint);
  if(operation==='receive')return exchange.receive(data.file);
  if(operation==='receipt')return exchange.receipt(data.file);
  throw new AppError('COLLABORATION_INVALID');
}
