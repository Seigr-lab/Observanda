import {t} from './i18n/index.js';
export function workspaceRenamePanel(storage,esc){
 const value=storage?.rename;if(!value)return '';
 return `<section class="panel" data-workspace-rename><h2>${esc(t('workspaceRename','title'))}</h2><p>${esc(t('workspaceRename','hint'))}</p><p><strong>${esc(value.sourceName)}</strong> &rarr; <strong>${esc(value.name)}</strong></p><button class="button primary" data-action="storage-rename-resume">${esc(t('workspaceRename','resume'))}</button></section>`;
}
