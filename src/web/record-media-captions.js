// Caption tracks of a lab book video, served as plain WebVTT by the media
// route of the record's own owner: /api/media/<id>/captions/<language>.
export function recordCaptionURL(assetUrl,attachmentId,language,recordId){
 const url=new URL(assetUrl(attachmentId),'http://observanda.invalid');
 url.pathname+='/captions/'+encodeURIComponent(language);url.searchParams.set('record',recordId);
 return url.pathname+url.search;
}
export function recordCaptionTracks(attachment,{recordId,assetUrl,esc}){
 if(attachment?.kind!=='video'||!Array.isArray(attachment.captions)||!recordId)return '';
 return attachment.captions.map((track,i)=>'<track kind="captions" src="'+esc(recordCaptionURL(assetUrl,attachment.id,track.language,recordId))+'" srclang="'+esc(track.language)+'" label="'+esc(track.label)+'"'+(i===0?' default':'')+'>').join('');
}
