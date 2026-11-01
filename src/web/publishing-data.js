import {t} from './i18n/index.js';
import {emptyWebsiteSelection} from './website-selection.js';
import {validWebsitePin,sameWebsitePin} from './website-pin.js';
const tr=key=>t('publishingData',key);
export function registerPublishingData(registry){
 registry.register({id:'pages',metadataOnly:true,label:tr('pages'),group:tr('group'),icon:'website',defaultFields:['intro','share'],items:c=>(c.book.pages??[]).map(p=>({key:p.id,title:p.title,data:p,action:{name:'website'}}))});
 registry.register({id:'website',metadataOnly:true,label:tr('website'),group:tr('group'),icon:'website',defaultFields:['projects','records','pages'],
  loadKey:c=>JSON.stringify([c.book.id,c.etag,Boolean(c.outline)]),
  load:async({context:c,api,signal})=>{
   if(!c.outline)return null;
   // The dashboard has a research outline, not an opened website document.
   // Resolve its default website before requesting counts tied to both revisions.
   const version=await api('/api/websites/version',{id:null},{adopt:false,signal}),websitePin=version.websitePin;
   if(version.workspaceId!==c.book.id||version.etag!==c.etag||!validWebsitePin(websitePin)||websitePin.researchSnapshotId!==c.etag||websitePin.websiteId!==null)throw Error(tr('invalid'));
   const result=await api('/api/website/research/summary',{workspaceId:c.book.id,snapshotId:c.etag,websitePin,selection:emptyWebsiteSelection(),search:''},{adopt:false,signal});
   if(result.workspaceId!==c.book.id||result.snapshotId!==c.etag||!sameWebsitePin(result.websitePin,websitePin)||!Number.isSafeInteger(result.entries)||result.entries<0)throw Error(tr('invalid'));
   return result.entries;
  },
  items:(c,loaded)=>[{key:c.book.id,title:tr('content'),data:{projects:c.book.projects.filter(p=>p.share).length,records:c.outline?loaded:c.book.entries.filter(e=>e.share).length,pages:(c.book.pages??[]).filter(p=>p.share).length},action:{name:'website'}}]});
}
