import {remoteAddress} from './website-remote-receipt.js';

const sampleKinds=['removed','changed','added'];
const short=value=>typeof value==='string'?value.slice(0,12):'';
// The release view compares the saved website with the edition the selected
// destination acknowledged. Every action leads to an ordinary reviewed update
// or withdrawal; nothing here writes to a destination directly.
export function websiteFilesReleases({request,site,esc,tr,t,signal}){
 let overview=null,loading=false,error=null,ticket=0;
 const lang=()=>document.documentElement.lang||undefined;
 const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(lang()):tr('releaseUnknownTime');
 const button=(key,op,extra='')=>'<button type="button" class="button" data-action="website-files-releases-'+op+'" '+extra+'>'+esc(tr(key))+'</button>';
 const row=(label,value)=>'<dt>'+esc(label)+'</dt><dd>'+value+'</dd>';
 const code=value=>'<code title="'+esc(value)+'">'+esc(short(value))+'</code>';
 function destinationLabel(destination){
  if(destination.kind==='folder')return esc(destination.directory);
  if(destination.kind==='github'||destination.kind==='ssh')return esc((destination.kind==='github'?'GitHub':'SSH')+' · '+remoteAddress(destination.config));
  return esc(tr('releaseNoDestination'));
 }
 function editionLabel(edition){return esc(tr(edition==='withdrawal'?'releaseEditionWithdrawal':'releaseEditionWebsite'));}
 function deliveredView(value){
  const {delivered,transfer,pending,destination}=value;
  if(!delivered)return '<p>'+esc(tr(destination.kind==='choose'?'releaseChooseDestination':'releaseNothingDelivered'))+'</p>';
  const verification=delivered.verification;
  const live=destination.kind==='folder'?tr('releaseFolderVerified'):verification?verification.failed?tr('remoteLiveFailed'):t('publication','liveVerified',{count:verification.files,removed:verification.removed??0}):tr('releaseLiveUnchecked');
  return '<dl class="website-release-facts">'+row(tr('releaseDeliveredEdition'),editionLabel(delivered.edition)+' '+code(delivered.releaseId))+
   row(tr('releaseDeliveredAt'),esc(delivered.completedAt?date(delivered.completedAt):tr('releaseUnknownTime')))+
   (delivered.commit?row(tr('remoteCommit'),code(delivered.commit)):'')+row(tr('releaseLiveState'),esc(live))+'</dl>'+
   (transfer&&['running','failed'].includes(transfer.state)?'<p role="alert">'+esc(tr(transfer.uncertain?'remoteUnknown':'remoteIncomplete'))+'</p>':'')+
   (pending?'<p role="alert">'+esc(tr('releaseFolderPending'))+'</p>':'');
 }
 function changesView(value){
  if(!value.delivered)return '';
  if(value.current)return '<p role="status" data-release-current>'+esc(tr('releaseUpToDate'))+'</p>';
  if(!value.changes)return '<p>'+esc(tr('releaseInventoryUnknown'))+'</p>';
  const {counts,samples}=value.changes;
  const summary='<p role="status" data-release-outstanding>'+esc(tr('releaseOutstanding',{added:counts.added,changed:counts.changed,removed:counts.removed}))+'</p>';
  const lists=sampleKinds.filter(kind=>counts[kind]).map(kind=>{
   const more=counts[kind]-samples[kind].length;
   return '<details class="website-release-paths" data-release-kind="'+kind+'"'+(kind==='removed'?' open':'')+'><summary>'+esc(tr('releasePaths_'+kind,{count:counts[kind]}))+'</summary>'+
    (kind==='removed'?'<p class="hint">'+esc(tr('releaseRemovedHelp'))+'</p>':'')+
    '<ul>'+samples[kind].map(path=>'<li><code>'+esc(path)+'</code></li>').join('')+'</ul>'+(more>0?'<p>'+esc(tr('releaseMorePaths',{count:more}))+'</p>':'')+'</details>';
  }).join('');
  return summary+lists;
 }
 function historyView(value){
  if(!value.releases.length)return '';
  const items=value.releases.map((entry,i)=>'<li data-release-entry="'+i+'"><strong>'+editionLabel(entry.edition)+'</strong> · '+esc(date(entry.completedAt))+' · '+code(entry.releaseId)+
   (entry.edition==='website'?entry.versionAvailable?' '+button('releaseOpenVersion','version','data-index="'+i+'"'):' <span class="hint">'+esc(tr('releaseVersionGone'))+'</span>':'')+'</li>').join('');
  return '<section class="website-release-history"><h3>'+esc(tr('releaseHistory'))+'</h3><p class="hint">'+esc(tr('releaseRestoreHelp'))+'</p><ol>'+items+'</ol></section>';
 }
 function actions(value){
  const controllable=['folder','github','ssh'].includes(value.destination.kind);
  const unfinished=value.transfer?.uncertain||value.pending;
  const withdraw=controllable&&value.delivered&&value.delivered.edition!=='withdrawal'&&!unfinished;
  return '<div class="inline-actions">'+button('publishUpdate','update')+(withdraw?button('releaseWithdraw','withdraw'):'')+button('releaseRefresh','refresh')+button('closePreview','close')+'</div>'+
   '<p class="hint">'+esc(tr(controllable?'releaseIndependentCopies':'releaseManualRemediation'))+'</p>';
 }
 function view(){
  const current=site();if(!current)return '';
  let body;
  if(error)body='<p role="alert">'+esc(error)+'</p>'+button('releaseRefresh','refresh')+button('closePreview','close');
  else if(!overview||loading)body='<p role="status">'+esc(tr('loading'))+'</p>';
  else body='<dl class="website-release-facts">'+row(tr('savedWebsiteRevision'),code(overview.revision))+row(tr('releaseSavedEdition'),code(overview.releaseId)+' · '+esc(tr('releaseFileCount',{count:overview.files})))+
   row(tr('destination'),destinationLabel(overview.destination))+'</dl>'+deliveredView(overview)+changesView(overview)+actions(overview)+historyView(overview)+
   (overview.otherReleases?'<p class="hint">'+esc(tr('releaseOtherDestinations',{count:overview.otherReleases}))+'</p>':'');
  return '<section class="panel website-files-publish website-releases" data-website-releases><h2 tabindex="-1" data-release-heading>'+esc(tr('releasesTitle'))+'</h2>'+body+'</section>';
 }
 async function open(){
  const current=site(),active=++ticket;loading=true;error=null;
  try{
   const value=await request('release/overview',{siteId:current.site.id,expectedRevision:current.site.revision},{signal:signal()});
   if(active!==ticket||site()?.site.revision!==value.revision)return;
   overview=value;
  }catch(reason){if(active===ticket&&reason.name!=='AbortError')error=reason.message;}
  finally{if(active===ticket)loading=false;}
 }
 return {view,open,reset(){ticket++;overview=null;error=null;loading=false;},
  entry:index=>overview?.releases[Number(index)]??null,
  destination:()=>overview?.destination??null,
  focus(){requestAnimationFrame(()=>document.querySelector('[data-release-heading]')?.focus({preventScroll:true}));}};
}
