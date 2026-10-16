// Shared ordering for original-file manifests. UTF-16 code-unit order matches
// the importer, without locale-dependent filename or numeric comparisons.
export const evidencePurposes=['evidence','preparation','current-return','historical-input','analysis'];
// Descriptive relative paths only: never resolve these against the host filesystem.
export const validEvidencePath=value=>typeof value==='string'&&value.length<=4096&&!/[\u0000-\u001f\u007f\\:]/u.test(value)&&value.split('/').every(p=>p.trim()&&p.length<=255&&!['.','..'].includes(p));
export const validEvidenceFile=file=>file&&typeof file.name==='string'&&file.name.trim()&&file.name.length<=255&&!/[\u0000-\u001f\\/:]/u.test(file.name)&&!['.','..'].includes(file.name)&&Number.isSafeInteger(file.size)&&file.size>=0&&typeof file.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(file.fingerprint)&&(!Object.hasOwn(file,'sourcePath')||validEvidencePath(file.sourcePath)&&file.sourcePath.split('/').at(-1)===file.name);
export const evidenceFileMetadata=({name,size,fingerprint,sourcePath})=>({name,size,fingerprint,...(sourcePath===undefined?{}:{sourcePath})});
export const compareEvidenceFiles=(a,b)=>(a.sourcePath??a.name)<(b.sourcePath??b.name)?-1:(a.sourcePath??a.name)>(b.sourcePath??b.name)?1:a.size-b.size||(a.fingerprint<b.fingerprint?-1:a.fingerprint>b.fingerprint?1:0);
export function evidenceFileKey(file){
 const location=file.sourcePath??file.name;let name='';for(let i=0;i<location.length;i++)name+=location.charCodeAt(i).toString(16).padStart(4,'0');
 return name+'!'+String(file.size).padStart(16,'0')+'!'+file.fingerprint+'!'+String(file.ordinal).padStart(5,'0');
}
