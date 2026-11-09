import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {websiteRecordingKind} from './website-recordings.js';

// Only the current editing session may retain retired site-owned assets. The
// files stay encrypted in their original owner and never enter a publication.
const maxFiles=256,maxBytes=128*1024*1024,lifetime=24*60*60*1000;
const png=/^pictures\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.png$/;
function owned(file){
 return !file.sourceId&&!file.feedAsset&&(file.picture===true&&file.contentType==='image/png'&&png.test(file.name)||Boolean(websiteRecordingKind(file)));
}
export function editHistory(manifest,key,page){
 if(key!==undefined&&!researchId(key))throw new AppError('INVALID');
 const history=manifest.editHistory;
 return key&&history?.key===key&&history.page===page&&history.expires>Date.now()?history.files:[];
}
export function validateEditHistory(store,manifest,names){
 const history=manifest.editHistory;if(history===undefined)return;
 if(!researchId(history?.key)||!Number.isSafeInteger(history.expires)||!manifest.pages.some(page=>page.path===history.page)||!Array.isArray(history.files)||history.files.length>maxFiles)throw new AppError('FORMAT');
 let bytes=0;const seen=new Set(names.keys()),owner=manifest.pages.find(page=>page.path===history.page);
 for(const file of history.files){
  if(!file||seen.has(file.name)||!owned(file)||file.draft&&!owner.draft||!Number.isSafeInteger(file.size)||file.size<=0||!store.validBlob(file,manifest.id,new Set()))throw new AppError('FORMAT');
  seen.add(file.name);bytes+=file.size;
 }
 if(bytes>maxBytes)throw new AppError('FORMAT');
}
export function retainEditHistory(manifest,files,key,page){
 const previous=editHistory(manifest,key,page);
 if(!key)return {};
 const live=new Set(files.map(f=>f.name)),kept=[];let bytes=0;
 const former=manifest.pages.find(p=>p.path===page);
 const names=new Set([...(former?.pictures??[]),...(former?.recordings??[]),...(manifest.pictureStyles?.[former?.draft?'draft-styles.css':manifest.cssPath]??[])]);
 // Newest last-use removals take priority over earlier undo transactions.
 for(const file of [...manifest.files.filter(f=>names.has(f.name)&&owned(f)),...previous]){
  if(live.has(file.name))continue;
  if(kept.length>=maxFiles||bytes+file.size>maxBytes)continue;
  kept.push(file);bytes+=file.size;
 }
 return {history:kept.length?{key,page,expires:Date.now()+lifetime,files:kept}:undefined};
}
export function editHistoryStamp(manifest){
 const history=manifest.editHistory;
 return history?createHash('sha256').update(JSON.stringify([manifest.revision,history.key])).digest('hex'):null;
}
