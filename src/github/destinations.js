import {AppError} from '../errors.js';
import {githubLogin} from './credential-helper.js';

const pageSize=30;
const invalid=()=>{throw new AppError('PUBLISH_REMOTE');};
const identity=value=>{
 if(!value||!Number.isSafeInteger(value.id)||value.id<=0||!githubLogin(value.login))invalid();
 return {id:value.id,login:value.login};
};
// Discovery never edits a destination or loads research. Fetch one bounded
// GitHub page at a time; a hidden organization is not evidence of nonexistence.
export async function githubDestinations(publisher,{kind,page=1,owner}={}){
 if(!['owners','repositories'].includes(kind)||!Number.isSafeInteger(page)||page<1||page>10000||kind==='repositories'&&!githubLogin(owner))throw new AppError('INVALID');
 const suffix='per_page='+pageSize+'&page='+page;
 const signal=AbortSignal.timeout(20000),read=route=>publisher.github(route,'GET',undefined,false,signal);
 if(kind==='owners'){
  // Repository-scoped tokens may not expose memberships. In that case use
  // the owners of repositories this token can access, without expanding scopes.
  let source='memberships';
  const membership=async()=>{
   try{return await read('/user/memberships/orgs?state=active&'+suffix);}
   catch(error){if(error.code!=='GITHUB_PERMISSION')throw error;source='repositories';return read('/user/repos?affiliation=organization_member,collaborator&sort=full_name&'+suffix);}
  };
  const [user,organizations]=await Promise.all([read('/user'),membership()]);
  if(!Array.isArray(organizations)||organizations.length>pageSize)invalid();
  const items=source==='memberships'?organizations.filter(value=>value?.state==='active').map(value=>({...identity(value.organization),kind:'organization'})):
   [...new Map(organizations.filter(value=>value?.owner?.type==='Organization'&&value.permissions?.push===true).map(value=>{const org=identity(value.owner);return [org.id,{...org,kind:'organization'}];})).values()];
  return {account:{...identity(user),kind:'account'},items,page,next:organizations.length===pageSize?page+1:null,source};
 }
 const user=identity(await read('/user'));
 const route=owner.toLowerCase()===user.login.toLowerCase()?'/user/repos?affiliation=owner&sort=full_name&'+suffix:'/orgs/'+encodeURIComponent(owner)+'/repos?type=all&sort=full_name&'+suffix;
 const repositories=await read(route);
 if(!Array.isArray(repositories)||repositories.length>pageSize)invalid();
 const items=repositories.filter(value=>value?.permissions?.push===true).map(value=>{
  if(!Number.isSafeInteger(value.id)||value.id<=0||typeof value.name!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(value.name)||value.owner?.login?.toLowerCase()!==owner.toLowerCase()||typeof value.default_branch!=='string'||value.default_branch.length>255)invalid();
  return {id:value.id,name:value.name,owner:identity(value.owner).login,branch:value.default_branch,private:value.private===true};
 });
 return {items,page,next:repositories.length===pageSize?page+1:null};
}
