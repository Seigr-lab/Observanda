import {t} from './i18n/index.js';

// Reading links retain their own immutable target instead of an index into the
// selected editable record. Several independently paged records may be visible.
export function readingMaterialReference(reference,esc,{workspaceId}={}){
 const target=reference.workspaceId||!workspaceId?reference:{...reference,workspaceId};
 return '<button type="button" class="text-button" data-action="material-figure-source" data-ref="'+esc(JSON.stringify(target))+'">'+esc(reference.label||t('analyses','resultSource'))+' &middot; '+esc(reference.revision.slice(0,12))+'</button>';
}
