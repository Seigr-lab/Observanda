import {readFileSync} from 'node:fs';
import {desktopLanguage} from './desktop-localization.js';
import {translator} from './web/i18n/runtime.js';
import messages from './web/locales/en/commandLine.json' with {type:'json'};
import errors from './web/locales/en/errors.json' with {type:'json'};
import intake from './web/locales/en/localIntake.json' with {type:'json'};
import progress from './web/locales/en/operationProgress.json' with {type:'json'};
import storage from './web/locales/en/storageProgress.json' with {type:'json'};

const references={commandLine:messages,errors,localIntake:intake,operationProgress:progress,storageProgress:storage};
const helpKeys=['helpReopen','helpHeadless','helpSetup','helpInit','helpPreferences','helpDatabase','helpRuntime','helpMac','helpInstall','helpExternalDatabase','helpDatabaseAccess','helpCredentials','helpEncryption','helpPassword','helpBuild','helpPublishing'];
// This is executable syntax, shared unchanged by every language.
const usage=`  npm start
  npm start -- --setup
  npm start -- --headless
  node src/cli.js open --workspace <directory> [--port 4173] [--no-browser] [--preferences <file>]
  node src/cli.js init --workspace "<parent>/Research Workspace 1" [--password-stdin]
  node src/cli.js inventory --source <export-directory> [--manifest inventory.observanda-source.json] [--expect-pin <sha256>] [--json]
  node src/cli.js validate --workspace <directory>
  node src/cli.js build --workspace <directory> --out <new-directory>`;

// A CLI invocation captures its language once. Reading it never repairs settings
// or starts workspace/database services, including for --preferences --help.
export function commandLineLocalization(preferencesFile){
 const language=desktopLanguage(preferencesFile)??'en',catalogues=new Map();
 const translate=(namespace,key,parameters)=>{
  if(!Object.hasOwn(references,namespace))throw new TypeError('Unknown CLI catalogue');
  if(!catalogues.has(namespace)){
   const reference=references[namespace],catalogue=language==='en'?reference:JSON.parse(readFileSync(new URL('./web/locales/'+language+'/'+namespace+'.json',import.meta.url),'utf8'));
   catalogues.set(namespace,translator(language,catalogue,reference));
  }
  return catalogues.get(namespace)(key,parameters);
 };
 const text=(key,parameters)=>translate('commandLine',key,parameters);
 return Object.freeze({language,text,translate,
  help:()=>text('heading')+'\n\n'+usage+'\n\n'+helpKeys.map(key=>text(key)).join('\n')+'\n\n'+translate('localIntake','cliHelp'),
  error:error=>translate('errors',Object.hasOwn(errors,error?.code)?error.code:'IO'),
  inventory:report=>text('inventoryReport',{status:text(report.complete?'inventoryComplete':'inventoryIncomplete'),...report.counts,pin:report.source.pin})
 });
}
