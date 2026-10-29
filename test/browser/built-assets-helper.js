import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';

// Qualify the packaged browser graph from a stable build for reload workflows.
export async function builtAssets(directory){
 const out=path.join(directory,'frontend');await buildBrowser({out});
 return createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});
}

// Preserve source URLs for tests that check lazy module loading, while keeping
// one consistent application graph across navigation and reloads.
export async function sourceAssets(){
 const assets=await createApplicationAssets();
 for(const name of assets.entries.keys())if(/\.(?:js|css|json|html|txt)$/.test(name))assets.set(name,await assets.read(name));
 return assets;
}
