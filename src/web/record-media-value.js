// Media bytes, identity and kind are owned by the existing attachment. This
// selected value can change only its description, provenance details and
// publication availability.
import {validRecordDate,dateParts} from './record-date.js';
const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
// Who made the photograph or recording, how it must be credited and under
// which licence, when and where it was captured, what it shows and which
// archive or collection it comes from. The capture date uses the record date
// contract (day, month, year, range or unknown, each possibly estimated), so
// an author never states more precision than is known; an optional time of
// day keeps its offset. Location is private evidence: publication outputs do
// not read these details unless they explicitly project them.
export const MEDIA_METADATA_FIELDS=['creator','credit','licence','capturedOn','capturedTime','subject','location','source'];
export const MEDIA_METADATA_LIMITS={creator:300,credit:600,licence:300,subject:600,location:600,source:600};
export const emptyMediaMetadata=()=>({creator:'',credit:'',licence:'',capturedOn:{kind:'unknown'},capturedTime:'',subject:'',location:'',source:''});
export function validCaptureTime(value){
 const match=typeof value==='string'&&/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))?$/.exec(value);
 return value===''||!!match&&Number(match[1])<=23&&Number(match[2])<=59&&Number(match[3]??0)<=59&&(!match[5]||Number(match[5])<=14&&Number(match[6])<=59);
}
export function validMediaMetadata(value,{draft=false}={}){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===[...MEDIA_METADATA_FIELDS].sort().join()&&
  Object.entries(MEDIA_METADATA_LIMITS).every(([key,max])=>plain(value[key],max))&&validRecordDate(value.capturedOn,{draft})&&
  validCaptureTime(value.capturedTime)&&(value.capturedTime===''||dateParts(value.capturedOn)?.kind==='day');
}
// Caption tracks of a video: WebVTT text in the lab book, one per language,
// shown with the video wherever it is published.
export const MEDIA_CAPTION_LIMIT=4,MEDIA_CAPTION_BYTES=512*1024;
const captionLanguage=value=>typeof value==='string'&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(value);
const webVTT=value=>typeof value==='string'&&new TextEncoder().encode(value).length<=MEDIA_CAPTION_BYTES&&/^\uFEFF?WEBVTT(?:[ \t][^\n]*)?(?:\r?\n|$)/.test(value)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export function validMediaCaptions(value){
 return Array.isArray(value)&&value.length>=1&&value.length<=MEDIA_CAPTION_LIMIT&&new Set(value.map(track=>track?.language)).size===value.length&&
  value.every(track=>track&&typeof track==='object'&&!Array.isArray(track)&&Object.keys(track).sort().join()==='label,language,vtt'&&captionLanguage(track.language)&&plain(track.label,80)&&track.label.trim()&&webVTT(track.vtt));
}
export const mediaDetails=({caption,alt,transcript,share,sharePdf,metadata,captions})=>({caption,alt,transcript,share,...(sharePdf===undefined?{}:{sharePdf}),...(metadata===undefined?{}:{metadata}),...(captions===undefined?{}:{captions})});
export function validMediaDetails(value,{draft=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value).filter(key=>!['sharePdf','metadata','captions'].includes(key)).sort().join();
 return keys==='alt,caption,share,transcript'&&Object.keys(value).every(key=>['alt','caption','share','transcript','sharePdf','metadata','captions'].includes(key))&&(!Object.hasOwn(value,'captions')||validMediaCaptions(value.captions))&&(!Object.hasOwn(value,'sharePdf')||typeof value.sharePdf==='boolean')&&(!Object.hasOwn(value,'metadata')||validMediaMetadata(value.metadata,{draft}))&&typeof value.share==='boolean'&&['caption','alt','transcript'].every(key=>typeof value[key]==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value[key]));
}
