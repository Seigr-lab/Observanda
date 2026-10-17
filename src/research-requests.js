import {RecordConfigurationSeed} from './record-configuration-seed.js';
import {ConfigurationCommands} from './configuration-commands.js';
import {recordDraftRequest} from './record-draft-requests.js';
import {withDatabaseRequest} from './database-request-context.js';
// HTTP adapters and project routing share these domain commands. The supplied
// storage owner is carried through every command and evidence service.
import {WorkspaceReader} from './workspace-reader.js';
import {DashboardRecords} from './dashboard-records.js';
import {DashboardTypeQuery} from './dashboard-type-query.js';
import {RecordTypeQuery} from './record-type-query.js';
import {DashboardDiscovery} from './dashboard-discovery.js';
import {TimelineQuery} from './timeline-query.js';
import {StructureCommands} from './structure-commands.js';
import {RecordViews} from './record-views.js';
import {RecordQuery} from './record-query.js';
import {RecordHistory} from './record-history.js';
import {RecordWriting} from './record-writing.js';
import {RecordValues} from './record-values.js';
import {RecordContent} from './record-content.js';
import {RecordSelectors} from './record-selectors.js';
import {RecordRuns} from './record-runs.js';
import {RecordRunCreation} from './record-run-creation.js';
import {RecordLocation} from './record-location.js';
import {RecordSectionCommands} from './record-section-commands.js';
import {RecordMediaCommands} from './record-media-commands.js';
import {RecordFigureCommands} from './record-figure-commands.js';
import {RecordTagCommands} from './record-tag-commands.js';
import {ResearchRecords,recordRevisions} from './research.js';
import {MediaStore} from './media.js';
import {upgradeNotebook,MAX_BYTES} from './model.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';
import {figureCopyChoices,figureCopySource} from './record-figure-copy-values.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {AppError} from './errors.js';

const commands=new Map();
const define=(suffix,Owner,method,{write=false,large=false,media=false,cancellable=false,capacity=large?'recordCommand':null,run}={})=>commands.set('/api/'+suffix,{write,cancellable,limit:large?MAX_RECORD_COMMAND_BYTES:MAX_BYTES,capacity,run:run??((storage,data,options)=>new Owner(storage,...(media?[new MediaStore(storage)]:[]))[method](data,options))});
for(const [name,Owner,method] of [['dashboard',DashboardRecords,'read'],['dashboard-types',DashboardTypeQuery,'read'],['record-types',RecordTypeQuery,'read'],['discovery',DashboardDiscovery,'read'],['timeline',TimelineQuery,'list']])define('workspace/read/'+name,Owner,method);
for(const name of ['version','start','page','changes','change-page','selection','labels'])define('workspace/read/'+name,WorkspaceReader,name==='change-page'?'changePage':name,{run:name==='start'?(storage,data,options)=>new WorkspaceReader(storage).start({...data,...options}):undefined});
for(const [name,Owner,method] of [
 ['query',RecordQuery,'list'],['open',RecordQuery,'open'],['history/list',RecordHistory,'list'],['history/read',RecordHistory,'read'],
 ['writing/read',RecordWriting,'read'],['values/read',RecordValues,'read'],['values/figures',RecordValues,'figureChoices'],['values/attempt-context',RecordValues,'attemptContext'],
 ['runs',RecordRuns,'list'],['runs/comparison',RecordRuns,'comparison'],['runs/prepare',RecordRunCreation,'prepare']
])define('research/records/'+name,Owner,method,{media:Owner===RecordHistory});
define('research/records/values/choices',RecordValues,'choices');
define('research/materials/record',RetainedRecordDocuments,'read');
define('workspace/read/record-content',RecordContent,'read');define('workspace/read/record-selectors',RecordSelectors,'read');
for(const [name,run] of [['figure-copy-choices',figureCopyChoices],['figure-copy-source',figureCopySource]])define('research/records/values/'+name,null,null,{run});
for(const [name,Owner,method,large] of [
 ['writing/save',RecordWriting,'save',true],['values/save',RecordValues,'save',true],['sections',RecordSectionCommands,'run',true],
 ['media',RecordMediaCommands,'run',true],['figures',RecordFigureCommands,'run',true],['tags',RecordTagCommands,'run',true],
 ['location',RecordLocation,'move',false],['runs/create',RecordRunCreation,'create',false],['remove',ResearchRecords,'remove',false]
])define('research/records/'+name,Owner,method,{write:true,large,media:Owner===ResearchRecords});
for(const [name,Owner,method] of [['save',ResearchRecords,'save'],['history/restore',RecordHistory,'restore']])define('research/records/'+name,Owner,method,{write:true,large:name==='save',run:(storage,{recordIds=null,receipt=false,...command})=>new Owner(storage,new MediaStore(storage))[method](command,{compact:true,recordIds,receipt})});
for(const kind of ['structure','notebook'])define('workspace/'+kind,null,null,{write:true,cancellable:true,run:(storage,data,options)=>new StructureCommands(storage).execute(kind,data,options)});
for(const method of ['list','save','remove'])define('research/views/'+method,RecordViews,method,{write:method!=='list'});
for(const method of ['open','window','item','section','profiles','change','save','discard'])define('research/configurations/'+method,ConfigurationCommands,method,{write:['change','save','discard'].includes(method)});
define('research/configurations/seed',RecordConfigurationSeed,'seed',{write:true});
export const researchRequest=route=>commands.get(route)??recordDraftRequest(route);
export async function executeResearchRequest(storage,route,data,options={}){
 const command=researchRequest(route);if(!command)throw new AppError('NOT_FOUND');
 const requestOptions=command.write&&!command.cancellable?{...options,signal:undefined}:options;
 const result=await withDatabaseRequest(requestOptions.signal,()=>command.run(storage,data,requestOptions));
 // Catalogue outlines already passed native metadata admission. They are not
 // legacy whole-workspace documents and retain their referenced schemas.
 if(!result?.book||result.outline===true)return result;
 const book=upgradeNotebook(result.book);return {...result,book,recordRevisions:result.recordRevisions??recordRevisions(book)};
}
