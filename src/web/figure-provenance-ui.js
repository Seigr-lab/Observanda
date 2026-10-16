import {figureSourceEntries} from './figure-provenance.js';
import {t} from './i18n/index.js';
export function figureSourceView(figure,esc){
 const entries=figureSourceEntries([figure]);if(!entries.length)return '';
 return '<div class="figure-sources">'+entries.map(({figure:f,ref})=>'<p>'+esc(t('figureProvenance','retained',{title:f.title,revision:ref.revision.slice(0,12)}))+' <button type="button" class="button" data-action="material-figure-source" data-ref="'+esc(JSON.stringify(ref))+'">'+esc(t('figureProvenance','inspect'))+'</button></p>').join('')+'</div>';
}
