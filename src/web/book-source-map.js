import {t} from './i18n/index.js';
// The ranges refer to authenticated original bytes, never reserialized HTML.
export function bookSourceMap(conversion,file,esc){
 if(!conversion?.mappings?.length)return '';
 const text=k=>esc(t('book',k));
 return '<details class="book-source-map"><summary>'+text('sourceMappings')+'</summary><p>'+text('originalHash')+': <code>'+esc(file.sha256)+'</code></p><div class="book-table-scroll" tabindex="0" role="region" aria-label="'+text('sourceMappings')+'"><table><thead><tr>'+['mappedKind','blockIdentity','byteOffset','byteLength'].map(k=>'<th scope="col">'+text(k)+'</th>').join('')+'</tr></thead><tbody>'+conversion.mappings.map(m=>'<tr><td>'+esc(m.kind)+'</td><td><code>'+esc(m.id)+'</code></td><td>'+m.offset+'</td><td>'+m.length+'</td></tr>').join('')+'</tbody></table></div></details>';
}
