export function remoteAddress(config){
 if(config.kind==='github'){
  const {owner,repository,branch,directory}=config.github;
  return [owner+'/'+repository,branch,directory].filter(Boolean).join(' / ');
 }
 const {user,host,port,directory}=config.ssh;
 return (user?user+'@':'')+host+(port&&port!==22?':'+port:'')+':'+directory+'/current';
}
export function remoteReceiptView(destination,revision,{esc,t,tr,button}){
 if(!destination)return '';
 const {transfer,receipt,config}=destination;
 if(!transfer&&!receipt)return '';
 const unfinished=transfer&&['running','failed'].includes(transfer.state);
 const same=transfer?.revision===revision&&transfer?.configEtag===destination.etag;
 const line=(label,value)=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>';
 const statusKeys={'uploaded-remote-verified':'pubSshUploaded','uploaded-repository-only':'pubRepositoryUploaded','uploaded-pages-setup-required':'pubPagesFailed','uploaded-awaiting-pages':'pubPagesPending'};
 const status=receipt&&(statusKeys[receipt.status]?t('websiteAuthoring',statusKeys[receipt.status]):t('publication','livePending'));
 const date=at=>Number.isFinite(Date.parse(at))?new Date(at).toLocaleString(document.documentElement.lang||undefined):'–';
 const live=receipt?.verification;
 return '<section data-website-files-transfer><h3>'+esc(t('websiteAuthoring','pubLastOperation'))+'</h3>'+
  (unfinished?'<p role="status">'+esc(tr(transfer.uncertain?'remoteUnknown':'remoteIncomplete'))+'</p>'+(transfer.total===null?'':'<p>'+esc(tr('remoteProgress',{done:transfer.uploaded,total:transfer.total}))+'</p>')+
   (transfer.errorCode?'<p>'+esc(t('errors',transfer.errorCode))+'</p>':'')+
   (same?button('remoteResume','publish-retry'):'<p>'+esc(tr('remoteChanged'))+'</p>')+
   button('remoteSettle','publish-settle'):'')+
  (transfer?.state==='settled'?'<p role="status">'+esc(tr('remoteSettled'))+'</p>':'')+
  (receipt?'<p>'+esc(status)+'</p><dl>'+line(tr('remoteRelease'),receipt.releaseId)+line(tr('remoteCommit'),receipt.commit)+line(tr('remoteRecorded'),date(receipt.at))+'</dl>'+
   (live?'<p>'+esc(live.failed?tr('remoteLiveFailed'):t('publication','liveVerified',{count:live.files,removed:live.removed??0}))+'</p>':'')+
   (config.publicUrl||config.kind==='github'&&config.github.pages!==false?button('remoteVerify','publish-verify'):''):'')+'</section>';
}
