import {digest} from './storage-format.js';
import {DurableJobs} from './jobs.js';
import {sameWebsitePin} from './web/website-pin.js';

// A preparation can deliberately narrow an edition or render an unsaved draft
// at exactly the same pinned base. Such output cannot replace the saved site.
export async function retainedSavedWebsite(releases,pin,{signal}={}){
 let cursor=null;
 do{
  const page=await releases.feed.page({cursor,limit:24});
  for(const item of page.items){
   signal?.throwIfAborted();const reviewId=digest(item.id),stored=await releases.stored(reviewId);
   if(!stored||!sameWebsitePin(stored.websitePin,pin))continue;
   const source=await releases.source(stored.jobId);
   if(!sameWebsitePin(source.websitePin,pin))continue;
   let exact=source.savedWebsiteComposition===1;
   if(!exact&&source.requestRevision){
    const job=await new DurableJobs(releases.workspace,{}).read(stored.jobId);
    if(job?.type==='publication.prepare'&&job.state==='completed'&&job.input.revision===source.requestRevision){
     const request=releases.request(job);
     exact=sameWebsitePin(request.command.websitePin,pin)&&request.command.edition===undefined&&request.command.websiteDraft===undefined&&request.sources===undefined;
    }
   }
   if(exact)return {candidate:await releases.read(reviewId,{signal}),retained:source};
  }
  cursor=page.next;
 }while(cursor);
 return null;
}