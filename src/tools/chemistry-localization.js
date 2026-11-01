import {translator,resolveLanguage} from '../web/i18n/runtime.js';
import en from '../web/locales/en/chemistryDiagnostics.json' with {type:'json'};
import ca from '../web/locales/ca/chemistryDiagnostics.json' with {type:'json'};
import es from '../web/locales/es/chemistryDiagnostics.json' with {type:'json'};
import nb from '../web/locales/nb/chemistryDiagnostics.json' with {type:'json'};
import nn from '../web/locales/nn/chemistryDiagnostics.json' with {type:'json'};
// Worker display requests select only these bundled catalogues. No browser
// preference or process-wide language can affect another request or model.
const catalogues={en,ca,es,nb,nn};
const translate=Object.fromEntries(Object.entries(catalogues).map(([locale,messages])=>[locale,translator(locale,messages,en)]));
export function chemistryTranslator(language){
 const text=translate[resolveLanguage(language)];
 return (namespace,key,values)=>{
  if(namespace!=='chemistryDiagnostics')throw new TypeError('Unsupported chemistry message namespace');
  return text(key,values);
 };
}
