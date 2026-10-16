import messages from './web/locales/en/startup.json' with {type:'json'};
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Bootstrap recovery cannot depend on the module graph it helps recover. Ship
// its English fallback in the same classic script, from the shared catalogue.
export function startupAssets(assets){
 const script=assets.get('startup.js').toString('utf8'),html=assets.get('index.html').toString('utf8');
 assets.set('startup.js',Buffer.from('"use strict";\n(()=>{\nconst messages='+JSON.stringify(messages).replaceAll('<','\\u003c')+';\n'+script+'\n})();'));
 assets.set('index.html',Buffer.from(html.replace(/\{\{startup\.(opening|skip)\}\}/g,(_match,key)=>escape(messages[key]))));
}
