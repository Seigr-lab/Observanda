// Caption tracks of a lab book video, served as plain WebVTT by the media
// route of the record's own owner: /api/media/<id>/captions/<language>.
// A revision reference ({revision, source}) names the exact version shown.
export function recordCaptionURL(assetUrl,attachmentId,language,recordId,reference=null){
 const url=new URL(assetUrl(attachmentId),'http://observanda.invalid');
 url.pathname+='/captions/'+encodeURIComponent(language);url.searchParams.set('record',recordId);
 if(reference){url.searchParams.set('revision',reference.revision);url.searchParams.set('sourceKind',reference.source.kind);if(reference.source.id)url.searchParams.set('sourceId',reference.source.id);}
 return url.pathname+url.search;
}
export function recordCaptionTracks(attachment,{recordId,assetUrl,esc,reference=null}){
 if(attachment?.kind!=='video'||!Array.isArray(attachment.captions)||!recordId)return '';
 return attachment.captions.map((track,i)=>'<track kind="captions" src="'+esc(recordCaptionURL(assetUrl,attachment.id,track.language,recordId,reference))+'" srclang="'+esc(track.language)+'" label="'+esc(track.label)+'"'+(i===0?' default':'')+'>').join('');
}
