import {t,language} from './i18n/index.js';
import {recordDateLabel,dateParts} from './record-date.js';
import {validMediaMetadata} from './record-media-value.js';
const text=(key,values)=>t('recordValues',key,values);
const when=metadata=>{
 if(dateParts(metadata.capturedOn)?.kind==='unknown')return '';
 return recordDateLabel(metadata.capturedOn)+(metadata.capturedTime?' '+metadata.capturedTime:'');
};
// The attribution shown under a photograph or recording in the lab book:
// creator, credit and licence travel with the media wherever it is read.
export function mediaCreditLine(metadata,esc){
 if(!validMediaMetadata(metadata))return '';
 const parts=[metadata.creator&&text('mediaByCreator',{creator:metadata.creator}),metadata.credit,metadata.licence,when(metadata)].filter(Boolean);
 return parts.length?'<p class="record-media-credit">'+parts.map(esc).join(' · ')+'</p>':'';
}
// Full provenance for the private reader and editor, including location.
export function mediaMetadataList(metadata,esc){
 if(!validMediaMetadata(metadata))return '';
 const rows=[['mediaCreator',metadata.creator],['mediaCredit',metadata.credit],['mediaLicence',metadata.licence],['mediaCaptured',when(metadata)],['mediaSubject',metadata.subject],['mediaLocation',metadata.location],['mediaSource',metadata.source]].filter(([,value])=>value);
 return rows.length?'<dl class="record-media-metadata">'+rows.map(([key,value])=>'<dt>'+esc(text(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>':'';
}
// Collapsed provenance under a figure, so a gallery stays readable.
export function mediaMetadataDetails(metadata,esc){
 const list=mediaMetadataList(metadata,esc);
 return list?'<details class="record-media-provenance"><summary>'+esc(text('mediaSourceHeading'))+'</summary>'+list+'</details>':'';
}
// Technical facts probed from the original at intake (read-only).
export function mediaTechnicalList(technical,esc){
 if(!technical||typeof technical!=='object')return '';
 const number=value=>typeof value==='number'?value.toLocaleString(language()):String(value);
 const rows=[
  ['mediaDuration',technical.durationSeconds&&text('mediaSeconds',{seconds:technical.durationSeconds})],
  ['mediaSampleRate',Number.isSafeInteger(technical.sampleRate)&&text('mediaHertz',{rate:number(technical.sampleRate)})],
  ['mediaChannels',Number.isSafeInteger(technical.channels)&&(number(technical.channels)+(technical.channelLayout?' ('+technical.channelLayout+')':''))],
  ['mediaBitDepth',Number.isSafeInteger(technical.bitDepth)&&text('mediaBits',{bits:number(technical.bitDepth)})],
  ['mediaSampleFormat',technical.sampleFormat],
  ['mediaCodec',technical.audioCodec??technical.videoCodec??technical.codec],
  ['mediaPixels',Number.isSafeInteger(technical.width)&&Number.isSafeInteger(technical.height)&&number(technical.width)+' × '+number(technical.height)],
  ['mediaFrameRate',technical.frameRate]
 ].filter(([,value])=>value);
 return rows.length?'<dl class="record-media-technical" aria-label="'+esc(text('mediaTechnicalHeading'))+'">'+rows.map(([key,value])=>'<dt>'+esc(text(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>':'';
}
