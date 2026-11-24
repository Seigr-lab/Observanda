// Writes a broad workspace with a previous Observanda build, for the upgrade
// test to reopen with the current source. It runs as its own process and loads
// only the previous build's modules (never this repository's src or test code),
// so the data on disk is exactly what that build writes.
// Usage: node previous-build-writer.js <previous service folder> <work folder>
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

const [serviceArgument,workArgument]=process.argv.slice(2);
if(!serviceArgument||!workArgument){console.error('Usage: node previous-build-writer.js <service folder> <work folder>');process.exit(2);}
const service=path.resolve(serviceArgument),work=path.resolve(workArgument);
const load=relative=>import(pathToFileURL(path.join(service,'src',...relative.split('/'))).href);
const log=text=>process.stderr.write('# previous build: '+text+'\n');
async function step(name,operation){
 log(name);
 try{return await operation();}
 catch(error){error.message='Previous build step "'+name+'" failed: '+error.message+(error.details?' '+JSON.stringify(error.details).slice(0,1500):'');throw error;}
}

const version=JSON.parse(await readFile(path.join(service,'package.json'),'utf8')).version;
const [{DeviceStore,WindowsProtector},{seal,unseal,clearVault},{WorkspaceDatabases},{installDatabaseProvider},{createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess},{initializeLocation},{Workspace},{sampleNotebook},{ResearchRecords},{MediaStore},{ProjectRegistry},{ProjectCreation},{ProjectStorage},{LabBookCreation},{LabBookDirectory},{LabBookStorage},{ResearchMaterials},{workspaceModules},{readWorkspaceDashboard,writeWorkspaceDashboard},{WebsiteFileStore,websiteSourceId},{PdfDocuments},{pdfLayoutPreset}]=await Promise.all([
 'security/device-store.js','encryption.js','workspace-databases.js','workspace-database-context.js','access.js','locations.js','storage.js','sample.js','research.js','media.js','project-registry.js','project-creation.js','project-storage.js','lab-book-creation.js','lab-book-directory.js','lab-book-storage.js','research-materials.js','modules/index.js','security/dashboard-storage.js','website-file-store.js','pdf-documents.js','web/pdf-layout-model.js'
].map(load));

// The device key is protected the way the test device store protects it:
// DPAPI on Windows (usable by another process of the same user), otherwise a
// sealed secret, saved next to the key so the reopening process can read it.
const deviceFile=path.join(work,'device.key');
let protector;
if(process.platform==='win32')protector=new WindowsProtector();
else{
 const secret=randomBytes(32);await writeFile(deviceFile+'.secret',secret.toString('hex'),{mode:0o600,flag:'wx'});
 protector={available:()=>true,protect:async bytes=>seal(bytes,secret,'CI secret store'),unprotect:async bytes=>unseal(bytes,secret,'CI secret store')};
}
const deviceStore=new DeviceStore({file:deviceFile,protector});

const ownerId=randomUUID(),runtime=new WorkspaceDatabases({directory:path.join(work,'previous-runtime'),ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[];
const unlock=async root=>{const vault=await verifyAccess(await readAccess(root),'','',{deviceStore});vaults.push(vault);return vault;};
const ids={};let result;
try{
 const root=path.join(work,'workspace'),book=sampleNotebook();
 const ws=await step('create the workspace',async()=>{
  const access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
  await initializeLocation(root,book,access,vault);return new Workspace(root,vault);
 });
 ids.workspaceId=book.id;ids.sampleRecordIds=book.entries.map(entry=>entry.id);

 await step('save records with sections, tags, a relation and an image',async()=>{
  const media=new MediaStore(ws),records=new ResearchRecords(ws,media),base=(await ws.read()).book.entries.find(entry=>entry.id===book.entries[0].id);
  const image=await media.import(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'),'image');
  const record=values=>{const value={...structuredClone(base),sections:[],attachments:[],relations:[],...values};if(Object.hasOwn(value,'figures'))value.figures=[];return value;};
  const method=record({id:randomUUID(),title:'Upgrade method',body:'Method written by the previous build.',tags:['upgrade','method'],sections:[{id:randomUUID(),title:'Procedure',body:'Weigh the sample, record the mass, repeat.'}],attachments:[{id:image.id,kind:'image',caption:'Apparatus',alt:'Apparatus photograph',transcript:'',share:false}]});
  await records.save({workspaceId:book.id,changes:[{id:method.id,expectedRevision:null,record:method}]});
  const run=record({id:randomUUID(),title:'Upgrade observation',body:'Observation written by the previous build.',tags:['upgrade'],relations:[{id:randomUUID(),type:'Builds on',target:{workspaceId:book.id,kind:'record',id:method.id},label:method.title}]});
  await records.save({workspaceId:book.id,changes:[{id:run.id,expectedRevision:null,record:run}]});
  Object.assign(ids,{methodRecordId:method.id,methodSectionId:method.sections[0].id,imageId:image.id,runRecordId:run.id,runNotebookId:run.notebookId,relationId:run.relations[0].id});
 });

 const registry=new ProjectRegistry(ws,book.id);
 const project=await step('create a project',async()=>{
  const entry=(await new ProjectCreation(registry,deviceStore).create({id:randomUUID(),project:{id:randomUUID(),title:'Upgrade project',description:'',parentId:null,share:false,logoId:null},username:'',password:''})).project;
  return {entry,storage:new ProjectStorage(entry.root,entry.projectId,await unlock(entry.root))};
 });
 Object.assign(ids,{projectId:project.entry.projectId,projectRoot:project.entry.root,projectNamespaceId:project.entry.namespaceId});

 await step('create a lab book and save a record in it',async()=>{
  const entry=(await new LabBookCreation(project.storage,deviceStore,{publish:value=>new LabBookDirectory(registry).register(project.entry.projectId,value)}).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:project.entry.projectId,title:'Upgrade lab book'}})).book;
  const storage=new LabBookStorage(entry.root,entry.labBookId,await unlock(entry.root)),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:entry.labBookId,title:'Lab book observation'};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:entry.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  Object.assign(ids,{labBookId:entry.labBookId,labBookRoot:entry.root,labBookNamespaceId:entry.namespaceId,labBookRecordId:record.id});
 });

 await step('import a dataset and derive an aggregation',async()=>{
  const materials=new ResearchMaterials(ws),recordId=ids.runRecordId,bytes=Buffer.from('group,reading\n1,1.5\n1,2.5\n2,4.25\n');
  const upload=await materials.startImport({recordId,name:'readings.csv',size:bytes.length,provenance:'Synthetic upgrade capture'});await materials.appendImport(upload.id,0,[bytes]);
  const artifact=await materials.finishImport(upload.id),column=(name,representation)=>({name,representation,radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
  const dataset=await materials.dataset({recordId,title:'Upgrade readings',artifact,columns:[column('group','integer'),column('reading','decimal')]});
  const derived=await materials.dataset({recordId,title:'Upgrade grouped readings',aggregation:{version:1,source:dataset,keys:[0],values:[{column:1,operation:'median',name:'Median'}],missing:'skip',note:''}});
  const cells=async ref=>(await materials.datasetPage(ref,0)).rows.map(row=>row.cells);
  Object.assign(ids,{artifact,dataset,derived,datasetCells:await cells(dataset),derivedCells:await cells(derived)});
 });

 const modules=workspaceModules(ws),execute=(action,payload)=>modules.execute({workspaceId:book.id,commandId:randomUUID(),action,payload});
 await step('create an inventory resource',async()=>{
  const id=randomUUID();
  await execute('resource.create',{id,data:{projectId:null,placementId:null,name:'Upgrade reagent',code:'UPG-1',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'Shelf A',unit:'bottles',capacity:1,status:'available',links:[]},openingStock:{quantity:'5',projectId:null}});
  ids.resourceId=id;
 });

 await step('create a laboratory with a sample and an analysis',async()=>{
  const section=(key,label,field)=>({id:randomUUID(),profileId:null,key,label,description:'',enabled:true,fields:[field]});
  const samples=section('samples','Samples',{key:'mass',label:'Mass',type:'number',unit:'g',required:true,choices:[]}),analyses=section('analyses','Analyses',{key:'result',label:'Result',type:'text',unit:'',required:false,choices:[]});
  const labId=randomUUID(),lab={name:'Upgrade laboratory',description:'',archived:false,profiles:[],sections:[samples,analyses],links:[]};
  await execute('lab-space.save',{id:labId,expectedRevision:null,data:lab});
  const entry=(chosen,title,values)=>({title,labId,sectionId:chosen.id,schemaRevision:1,sectionSchema:{label:chosen.label,description:chosen.description,fields:structuredClone(chosen.fields)},notes:'',values,contributors:[],links:[]});
  const sampleId=randomUUID(),analysisId=randomUUID();
  await execute('lab-entry.save',{id:sampleId,expectedRevision:null,data:entry(samples,'Sample A',{mass:'12.5'})});
  await execute('lab-entry.save',{id:analysisId,expectedRevision:null,data:entry(analyses,'Analysis of sample A',{result:'Within range'})});
  Object.assign(ids,{labSpaceId:labId,sampleId,analysisId});
 });

 await step('save the dashboard',async()=>{
  const current=await readWorkspaceDashboard(ws),settings=structuredClone(current.settings);settings.views[0].name='Upgrade dashboard';
  await writeWorkspaceDashboard(ws,settings,current.etag);ids.dashboardViewId=settings.views[0].id;
 });

 await step('create a website with one record source',async()=>{
  const store=new WebsiteFileStore(ws),provenance={workspaceId:book.id,notebookId:ids.runNotebookId,recordId:ids.runRecordId},sourceId=websiteSourceId({...provenance,target:'website'});
  const token=await store.beginSourceUpdate({sourceId,target:'website'}),source=await store.putSource({sourceId,provenance,target:'website',visible:true,title:'Upgrade source',html:'<h2>Upgrade source</h2><p>Retained source text</p>',assets:[]},{token});
  const page=await store.create({name:'Upgrade site',html:'<!doctype html><html><head><title>Upgrade site</title></head><body><main><p>Site introduction</p></main></body></html>'});
  await store.insertSource(page.site.id,{sourceId:source.id,sourceRevision:source.revision,expectedRevision:page.site.revision,position:'start'});
  Object.assign(ids,{siteId:page.site.id,sourceId:source.id,sourceRevision:source.revision});
 });

 await step('create a PDF document in the project',async()=>{
  const documents=new PdfDocuments(project.storage,project.entry.namespaceId),id=randomUUID(),section={id:randomUUID(),title:'Observation',content:'Retained PDF text',layout:null,start:null};
  const created=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name:'Upgrade report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section}});
  Object.assign(ids,{pdfDocumentId:id,pdfSectionId:section.id,pdfRevision:created.revision});
 });
 result={version,root,deviceFile,ownerId,ids};
}finally{
 await runtime.close();detach();
 for(const vault of vaults)await clearVault(vault);
}
process.stdout.write(JSON.stringify(result)+'\n');
