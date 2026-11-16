import {GithubRepositorySetup} from './github-repository.js';
import {websitePublicationMetadata} from './website-publication-metadata.js';

// Repository creation and empty-repository initialization for one website made
// in the website editor. The setup job, its journal and the destination it
// saves live in that website's own publication folder; the durable job queue
// and its leases stay the workspace's.
export function fileSiteWorkspace(base,store,siteId){
 const site=websitePublicationMetadata(store.publicationWorkspace(siteId));
 return {...site,outline:()=>base.outline(),catalogue:(...args)=>base.catalogue(...args)};
}
// Every job a website starts carries its site id, and only that website can
// read its jobs back.
export function fileSiteJobQueue(queue,siteId){
 return new Proxy(queue,{get(target,key){
  if(key==='enqueueLocked')return command=>target.enqueueLocked({...command,input:{...command.input,fileSiteId:siteId}});
  if(key==='read')return async jobId=>{const job=await target.read(jobId);return job?.input.fileSiteId===siteId?job:null;};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
}
export function fileSiteRepositorySetup({base,store,siteId,publisher,queue}){
 return new GithubRepositorySetup(fileSiteWorkspace(base,store,siteId),publisher,fileSiteJobQueue(queue,siteId));
}
