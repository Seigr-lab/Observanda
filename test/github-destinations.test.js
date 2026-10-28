import {test} from 'node:test';
import assert from 'node:assert/strict';
import {githubDestinations} from '../src/github/destinations.js';
import {projectPublicationRequest} from '../src/project-publication-requests.js';
import {AppError} from '../src/errors.js';

test('destination discovery pages private memberships and writable repositories without research or remote writes',async()=>{
 const calls=[],org={id:2,login:'research-team'},publisher={github:async route=>{
  calls.push(route);if(route==='/user')return {id:1,login:'alice'};
  if(route.startsWith('/user/memberships/orgs?'))return route.endsWith('page=1')?Array.from({length:30},(_,i)=>({state:'active',organization:{id:2+i,login:'team-'+i}})):[{state:'active',organization:org},{state:'pending',organization:{id:3,login:'pending-team'}}];
  if(route.startsWith('/orgs/research-team/repos?'))return [{id:10,name:'private-site',owner:org,private:true,default_branch:'website',permissions:{push:true}},{id:11,name:'read-only',owner:org,default_branch:'main',permissions:{pull:true}}];
  if(route.startsWith('/user/repos?'))return [];
  throw Error('Unexpected request');
 }};
 const first=await githubDestinations(publisher,{kind:'owners'});assert.equal(first.items.length,30);assert.equal(first.next,2);assert.equal(first.account.login,'alice');
 const second=await githubDestinations(publisher,{kind:'owners',page:first.next});assert.deepEqual(second.items,[{...org,kind:'organization'}]);assert.equal(second.next,null);
 const repos=await githubDestinations(publisher,{kind:'repositories',owner:org.login});assert.deepEqual(repos.items,[{id:10,name:'private-site',owner:org.login,branch:'website',private:true}]);
 await githubDestinations(publisher,{kind:'repositories',owner:'Alice'});assert.ok(calls.some(route=>route.startsWith('/user/repos?affiliation=owner&')));
 for(const data of [{kind:'owners',page:0},{kind:'owners',page:1.5},{kind:'repositories',owner:'team/../../user'},{kind:'delete',owner:'team'}])await assert.rejects(githubDestinations(publisher,data),{code:'INVALID'});
 const route=projectPublicationRequest('/api/publishing/destinations','POST');assert.equal(route.write,false);assert.equal(route.snapshot,true);assert.equal(route.limit,1024);
 assert.equal(projectPublicationRequest('/api/github-connection/status','POST').admission,'control');
});

test('malformed or oversized GitHub pages cannot populate destination choices',async()=>{
 for(const response of [{},Array(31).fill({}),[{state:'active',organization:{id:1,login:'../../invalid'}}]]){
  await assert.rejects(githubDestinations({github:async route=>route==='/user'?{id:1,login:'alice'}:response},{kind:'owners'}),{code:'PUBLISH_REMOTE'});
 }
 await assert.rejects(githubDestinations({github:async route=>route==='/user'?{id:1,login:'alice'}:[{id:2,name:'wrong-owner',owner:{id:2,login:'another'},default_branch:'main',permissions:{push:true}}]},{kind:'repositories',owner:'research-team'}),{code:'PUBLISH_REMOTE'});
});

test('repository-only tokens discover accessible organization owners without silently bypassing SSO or rate limits',async()=>{
 const org={id:2,login:'research-team',type:'Organization'},calls=[];
 const publisher={github:async route=>{calls.push(route);if(route==='/user')return {id:1,login:'alice'};if(route.startsWith('/user/memberships/'))throw new AppError('GITHUB_PERMISSION');return [{owner:org,permissions:{push:true}},{owner:org,permissions:{push:true}},{owner:{id:3,login:'readonly',type:'Organization'},permissions:{pull:true}}];}};
 const result=await githubDestinations(publisher,{kind:'owners'});assert.equal(result.source,'repositories');assert.deepEqual(result.items,[{id:2,login:'research-team',kind:'organization'}]);assert.equal(calls.length,3);
 for(const code of ['GITHUB_ORGANIZATION_AUTH','GITHUB_RATE_LIMIT','GITHUB_RECONNECT'])await assert.rejects(githubDestinations({github:async()=>{throw new AppError(code);}},{kind:'owners'}),{code});
});
