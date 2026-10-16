import {t} from './i18n/index.js';

// File metadata belongs to the authenticated evidence list, not a narrative
// section. The download retains the exact artifact revision shown here.
export function materialFileSummary(item,{context,esc,downloadUrl=null,route=value=>value}){
 if(item.kind!=='artifact'||!item.file)return '';
 const file=item.file,href=downloadUrl??(route('/api/research/materials/original/'+item.id+'/'+item.revision)+'?context='+encodeURIComponent(context));
 return `<dl class="material-file-summary"><dt>${esc(t('materialFiles','name'))}</dt><dd>${esc(file.name)}</dd>${materialSourceLocation(file,esc)}<dt>${esc(t('materialFiles','size'))}</dt><dd>${esc(t('materialFiles','bytes',{bytes:file.size}))}</dd><dt>SHA-256</dt><dd><code>${esc(file.sha256)}</code></dd></dl><a class="button" href="${esc(href)}" download="${esc(file.name)}">${esc(t('materialFiles','download',{name:file.name}))}</a>`;
}
export function materialSourceLocation(file,esc){
 return (file.sourcePath?`<dt>${esc(t('materialFiles','sourcePath'))}</dt><dd>${esc(file.sourcePath)}</dd>`:'')+(file.sourcePurpose?`<dt>${esc(t('evidenceIntake','purpose'))}</dt><dd>${esc(t('evidenceIntake','purpose-'+file.sourcePurpose))}</dd>`:'');
}
