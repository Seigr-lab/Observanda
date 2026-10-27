import {readFile} from 'node:fs/promises';
import {createBrowserAssets} from './browser-assets.js';
import {pdfPreviewAssets} from './pdf-preview-assets.js';
import {bundledFonts,bundledFontCSS} from './fonts.js';

export async function createApplicationAssets(options){
 const assets=await createBrowserAssets(options);
 for(const [name,url] of await pdfPreviewAssets({deferred:true}))assets.file(name,url);
 // The source app and desktop package use the same small branding resources.
 for(const variant of ['black','white'])assets.set('observanda-'+variant+'.svg',await readFile(new URL('../desktop/icon_'+variant+'.svg',import.meta.url)));
 assets.set('observanda.svg',await assets.read('observanda-black.svg'));
 for(const [name,bytes] of bundledFonts)assets.set(name,bytes);assets.set('bundled-fonts.css',bundledFontCSS);
 return assets;
}
