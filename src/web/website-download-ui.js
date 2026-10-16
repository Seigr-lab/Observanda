import {t} from './i18n/index.js';
import {downloadSize} from './website-file.js';
export function websiteFileDetails(asset,esc){
 return `<p class="website-file-name">${esc(asset.name)} · ${esc(downloadSize(asset.size))}</p><details><summary>${esc(t('websiteMedia','fileIntegrity'))}</summary><p>${esc(asset.size.toLocaleString())} ${esc(t('websiteMedia','bytes'))}</p><p class="website-file-hash">SHA-256: <code>${esc(asset.sha256)}</code></p></details>`;
}
export function websiteDownloadFields(section,{book,esc,field,selector}){
 const asset=book.website.assets.find(a=>a.id===section.assetId&&a.kind==='file'),attrs=`data-home-section="${section.id}"`;
 return `${selector(section,{files:true,label:t('websiteMedia','file'),empty:t('websiteMedia','chooseFile')})}${field(t('websiteMedia','uploadFile'),`<input type="file" data-upload="website-file" data-target="element:${section.id}">`)}${asset?websiteFileDetails(asset,esc):''}<p class="muted">${esc(t('websiteMedia','fileHelp'))}</p>${field(t('websiteMedia','fileLabel'),`<input ${attrs} data-key="label" maxlength="160" value="${esc(section.label)}" placeholder="${esc(asset?.name??'')}">`)}${field(t('websiteMedia','fileDescription'),`<textarea ${attrs} data-key="body" rows="3" maxlength="60000">${esc(section.body)}</textarea>`)}`;
}
