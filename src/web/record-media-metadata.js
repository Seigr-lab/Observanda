import {t} from './i18n/index.js';
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
