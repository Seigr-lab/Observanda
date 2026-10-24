// The storage generation changes in the writer's transaction, together with
// its first new representation. Older applications reject unknown generations.
import {AppError} from './errors.js';
export const CATALOGUE_MAX_GENERATION=206158430329;
// New representations can be introduced with independent domain, settings
// and website owners. Preserve their requirements in either upgrade order.
export const catalogueRequiresDomains=format=>((configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.owners??0)>=1||[22,24,25,27,28,30,31,33,34,36,37,39,40,42,43,45,46,48,49].includes(format);
export const catalogueRequiresSettings=format=>((configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.owners??0)>=2||[25,28,31,34,37,40,43,46,49].includes(format);
export const catalogueRequiresWebsites=format=>((configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.website??0)>=1||[29,30,31,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49].includes(format);
export const catalogueRequiresStagedEvidence=format=>(configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.staged===true||[32,33,34,35,36,37,41,42,43,47,48,49].includes(format);
export const catalogueRequiresWebsiteEditor=format=>((configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.website??0)>=2||[38,39,40,41,42,43,44,45,46,47,48,49].includes(format);
export const catalogueRequiresWebsitePresentation=format=>((configurationCatalogueFeatures(format)??recordOwnerTransferCatalogueFeatures(format)??publicationCatalogueFeatures(format))?.website??0)>=3||[44,45,46,47,48,49].includes(format);
function storedCatalogueGeneration(value){
 // PostgreSQL int8 values are text by default. Normalize only this field;
 // archive headers and the public feature helpers still require numbers.
 if(typeof value==='string'){
  if(!/^[1-9][0-9]{0,15}$/.test(value))throw new AppError('CATALOGUE_DAMAGED');
  const number=Number(value);if(!Number.isSafeInteger(number)||String(number)!==value)throw new AppError('CATALOGUE_DAMAGED');value=number;
 }
 if(!Number.isSafeInteger(value))throw new AppError('CATALOGUE_DAMAGED');
 return value;
}
export async function catalogueFormat(db){
 const rows=await db.all('SELECT version FROM catalogue_format');
 if(rows.length!==1)throw new AppError('CATALOGUE_DAMAGED');
 const format=storedCatalogueGeneration(rows[0].version);
 if(![3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49].includes(format)&&!catalogueRequiresPublicationDocuments(format)&&!catalogueRequiresRecordOwnerTransfers(format)&&!catalogueRequiresConfigurationDocuments(format))throw new AppError('CATALOGUE_DAMAGED');
 return format;
}
export async function requireRecordBlocks(db){
 return requireCatalogueFormat(db,4);
}
export async function requireRecordQueryBlocks(db){return requireCatalogueFormat(db,5);}
export async function requireSearchVocabulary(db){return requireCatalogueFormat(db,16);}
export async function requireJoinedQueryText(db){return requireCatalogueFormat(db,17);}
export async function requireKeyedQueryArrays(db){return requireCatalogueFormat(db,18);}
export async function requireReferenceQueries(db){return requireCatalogueFormat(db,19);}
export async function requireAttemptQueries(db){return requireCatalogueFormat(db,20);}
export async function requireStarterDocuments(db){return requireCatalogueFormat(db,21);}
export async function requireRetiredProjectRecords(db){
 if(await catalogueFormat(db)>=23)return;
 await db.run('CREATE INDEX records_scope_revision ON records(scope_id,generation,id,revision COLLATE \"C\")');
 return requireCatalogueFormat(db,23);
}
export async function requireWorkspaceSettings(db){
 if(await upgradePublicationCatalogue(db,{owners:2}))return;
 await requireWorkspaceDomains(db);const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?49:46:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?43:40:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?37:34:format>=29?31:format>=26?28:25);
}
export async function requireWorkspaceDomains(db){
 if(await upgradePublicationCatalogue(db,{owners:1}))return;
 await requireRetiredProjectRecords(db);const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?48:45:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?42:39:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?36:33:format>=29?30:format>=26?27:24);
}
export async function requireProjectDomains(db){
 if(await upgradePublicationCatalogue(db,{owners:1}))return;
 const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?48:45:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?42:39:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?36:33:format>=29?30:format>=26?27:22);
}
export async function requireDraftDocuments(db){return requireCatalogueFormat(db,5);}
export async function requireMemberCollections(db){return requireCatalogueFormat(db,6);}
export async function requireSelectedValueDrafts(db){return requireCatalogueFormat(db,7);}
export async function requireRetainedRecordDocuments(db){return requireCatalogueFormat(db,8);}
export async function requireRunReceiptStore(db){return requireCatalogueFormat(db,9);}
export async function requireDraftEdits(db){return requireCatalogueFormat(db,10);}
export async function requireAttemptIndexes(db){return requireCatalogueFormat(db,11);}
export async function requireCurrentAttemptIndexes(db){return requireCatalogueFormat(db,12);}
export async function requireRecordTypeDrafts(db){return requireCatalogueFormat(db,13);}
export async function requireRecordMethodIndexes(db){return requireCatalogueFormat(db,14);}
export async function requireWebsiteDocuments(db){
 if(await upgradePublicationCatalogue(db,{website:1}))return;
 const previous=await catalogueFormat(db),domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));await requireRetiredProjectRecords(db);
 return requireCatalogueFormat(db,catalogueRequiresStagedEvidence(previous)?catalogueRequiresSettings(previous)?37:domains?36:35:catalogueRequiresSettings(previous)?31:domains?30:29);
}
export async function requireStagedEvidence(db){
 if(await upgradePublicationCatalogue(db,{staged:true}))return;
 const previous=await catalogueFormat(db);
 // Generation 23 admitted a retired-record index on either a plain catalogue
 // or an existing project owner. Preserve that older optional domain owner.
 const domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));
 await requireRetiredProjectRecords(db);
 const base=catalogueRequiresWebsitePresentation(previous)?47:catalogueRequiresWebsiteEditor(previous)?41:catalogueRequiresWebsites(previous)?35:32;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:domains?1:0));
}
// Durable website drafts and keyed collection descriptors must be understood
// before any writer can open their catalogue, including after restore.
export async function requireWebsiteEditor(db){
 if(await upgradePublicationCatalogue(db,{website:2}))return;
 await requireWebsiteDocuments(db);const previous=await catalogueFormat(db);
 const base=catalogueRequiresStagedEvidence(previous)?41:38;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:catalogueRequiresDomains(previous)?1:0));
}
// Selected presentation collections retain their own indexes and checkpoints.
// Older readers must decline the catalogue before writing those representations.
export async function requireWebsitePresentation(db){
 if(await upgradePublicationCatalogue(db,{website:3}))return;
 await requireWebsiteEditor(db);const previous=await catalogueFormat(db);
 const base=catalogueRequiresStagedEvidence(previous)?47:44;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:catalogueRequiresDomains(previous)?1:0));
}
export async function requireRecordResultIndexes(db){
 const previous=await catalogueFormat(db);await requireRetiredProjectRecords(db);
 return requireCatalogueFormat(db,catalogueRequiresSettings(previous)?28:catalogueRequiresDomains(previous)?27:26);
}
export async function requireFigureCopyDrafts(db){return requireCatalogueFormat(db,15);}
async function requireCatalogueFormat(db,version){
 if(!Number.isSafeInteger(version)||version<3||version>CATALOGUE_MAX_GENERATION)throw new AppError('CATALOGUE_DAMAGED');
 if(await catalogueFormat(db)>=version)return;
 // Keep historical int4 owners unchanged until an admitted generation needs
 // int8. The type, constraint and first new data share the writer transaction.
 if(version>2147483647)await db.run('ALTER TABLE catalogue_format ALTER COLUMN version TYPE bigint');
 await db.run('ALTER TABLE catalogue_format DROP CONSTRAINT catalogue_format_version_check');
 await db.run('ALTER TABLE catalogue_format ADD CONSTRAINT catalogue_format_version_check CHECK(version BETWEEN 3 AND '+CATALOGUE_MAX_GENERATION+')');
 await db.run('UPDATE catalogue_format SET version=$1 WHERE version<$1',version);
}

// Publication descriptors can be written by legacy inline catalogues as well
// as independent websites. These 24 combinations preserve existing owner
// requirements without manufacturing an absent website or module registry.
export function publicationCatalogueFeatures(format){
 const configured=configurationCatalogueFeatures(format);if(configured)return configured.publication?{website:configured.website,staged:configured.staged,owners:configured.owners}:null;
 const transferred=recordOwnerTransferCatalogueFeatures(format);
 if(transferred){if(!transferred.publication)return null;const {publication,...features}=transferred;return features;}
 if(!Number.isInteger(format)||format<50||format>73)return null;
 const value=format-50;return {website:Math.floor(value/6),staged:value%6>=3,owners:value%3};
}
export const catalogueRequiresPublicationDocuments=format=>publicationCatalogueFeatures(format)!==null;
export function publicationCatalogueGeneration({website,staged,owners}){
 if(!Number.isInteger(website)||website<0||website>3||typeof staged!=='boolean'||!Number.isInteger(owners)||owners<0||owners>2)throw new AppError('INVALID');
 return 50+website*6+(staged?3:0)+owners;
}
async function upgradePublicationCatalogue(db,changes){
 const format=await catalogueFormat(db),configured=configurationCatalogueFeatures(format);
 if(configured){await requireCatalogueFormat(db,configurationCatalogueGeneration({...configured,website:Math.max(configured.website,changes.website??0),staged:configured.staged||changes.staged===true,owners:Math.max(configured.owners,changes.owners??0)}));return true;}
 const transferred=recordOwnerTransferCatalogueFeatures(format);
 if(transferred){await requireCatalogueFormat(db,recordOwnerTransferCatalogueGeneration({...transferred,website:Math.max(transferred.website,changes.website??0),staged:transferred.staged||changes.staged===true,owners:Math.max(transferred.owners,changes.owners??0)}));return true;}
 const previous=publicationCatalogueFeatures(format);if(!previous)return false;
 await requireCatalogueFormat(db,publicationCatalogueGeneration({website:Math.max(previous.website,changes.website??0),staged:previous.staged||changes.staged===true,owners:Math.max(previous.owners,changes.owners??0)}));return true;
}
export async function requirePublicationDocuments(db){
 const previous=await catalogueFormat(db);if(catalogueRequiresPublicationDocuments(previous))return;
 const configured=configurationCatalogueFeatures(previous);if(configured)return requireCatalogueFormat(db,configurationCatalogueGeneration({...configured,publication:true}));
 const transferred=recordOwnerTransferCatalogueFeatures(previous);if(transferred)return requireCatalogueFormat(db,recordOwnerTransferCatalogueGeneration({...transferred,publication:true}));
 const domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));
 const features={website:catalogueRequiresWebsitePresentation(previous)?3:catalogueRequiresWebsiteEditor(previous)?2:catalogueRequiresWebsites(previous)?1:0,staged:catalogueRequiresStagedEvidence(previous),owners:catalogueRequiresSettings(previous)?2:domains?1:0};
 await requireRetiredProjectRecords(db);return requireCatalogueFormat(db,publicationCatalogueGeneration(features));
}
// Archive and direct rekey share this exact restoration instead of maintaining
// parallel 24-entry switches. Copied owner rows are verified by their owners.
export async function restorePublicationCatalogueFormat(db,format){
 if(catalogueRequiresConfigurationDocuments(format)&&catalogueRequiresPublicationDocuments(format))return restoreConfigurationCatalogueFormat(db,format);
 if(catalogueRequiresRecordOwnerTransfers(format)&&catalogueRequiresPublicationDocuments(format))return restoreRecordOwnerTransferCatalogueFormat(db,format);
 const features=publicationCatalogueFeatures(format);if(!features)throw new AppError('CATALOGUE_DAMAGED');
 if(features.owners===2)await requireWorkspaceSettings(db);else if(features.owners===1)await requireWorkspaceDomains(db);
 if(features.website===3)await requireWebsitePresentation(db);else if(features.website===2)await requireWebsiteEditor(db);else if(features.website===1)await requireWebsiteDocuments(db);
 if(features.staged)await requireStagedEvidence(db);await requirePublicationDocuments(db);
 if(await catalogueFormat(db)!==format)throw new AppError('CATALOGUE_DAMAGED');
}

// A record transfer introduces authenticated history envelopes and write fences.
// Its independent flags retain the exact owner and publication requirements.
export function recordOwnerTransferCatalogueFeatures(format){
 const configured=configurationCatalogueFeatures(format);if(configured)return configured.transfers?{website:configured.website,staged:configured.staged,owners:configured.owners,publication:configured.publication}:null;
 if(!Number.isInteger(format)||format<74||format>121)return null;
 const value=(format-74)%24;return {website:Math.floor(value/6),staged:value%6>=3,owners:value%3,publication:format>=98};
}
export const catalogueRequiresRecordOwnerTransfers=format=>recordOwnerTransferCatalogueFeatures(format)!==null;
export function recordOwnerTransferCatalogueGeneration({website,staged,owners,publication}){
 if(typeof publication!=='boolean')throw new AppError('INVALID');
 return publicationCatalogueGeneration({website,staged,owners})+24+(publication?24:0);
}
export async function requireRecordOwnerTransfers(db){
 const previous=await catalogueFormat(db);if(catalogueRequiresRecordOwnerTransfers(previous))return;
 const configured=configurationCatalogueFeatures(previous);if(configured)return requireCatalogueFormat(db,configurationCatalogueGeneration({...configured,transfers:true}));
 const domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));
 const features={website:catalogueRequiresWebsitePresentation(previous)?3:catalogueRequiresWebsiteEditor(previous)?2:catalogueRequiresWebsites(previous)?1:0,staged:catalogueRequiresStagedEvidence(previous),owners:catalogueRequiresSettings(previous)?2:domains?1:0,publication:catalogueRequiresPublicationDocuments(previous)};
 await requireRetiredProjectRecords(db);return requireCatalogueFormat(db,recordOwnerTransferCatalogueGeneration(features));
}
export async function restoreRecordOwnerTransferCatalogueFormat(db,format){
 if(catalogueRequiresConfigurationDocuments(format)&&catalogueRequiresRecordOwnerTransfers(format))return restoreConfigurationCatalogueFormat(db,format);
 const features=recordOwnerTransferCatalogueFeatures(format);if(!features)throw new AppError('CATALOGUE_DAMAGED');
 if(features.owners===2)await requireWorkspaceSettings(db);else if(features.owners===1)await requireWorkspaceDomains(db);
 if(features.website===3)await requireWebsitePresentation(db);else if(features.website===2)await requireWebsiteEditor(db);else if(features.website===1)await requireWebsiteDocuments(db);
 if(features.staged)await requireStagedEvidence(db);if(features.publication)await requirePublicationDocuments(db);await requireRecordOwnerTransfers(db);
 if(await catalogueFormat(db)!==format)throw new AppError('CATALOGUE_DAMAGED');
}

// Immutable notebook configurations and project templates are snapshot-owned.
// Each 96-generation family preserves independent owners. Feature families
// additionally require publication permissions, paged website source choices
// and nested preparation collections before an older app can open the catalogue.
export function configurationCatalogueFeatures(format){
 if(!Number.isSafeInteger(format)||format<122||format>CATALOGUE_MAX_GENERATION)return null;
 const value=(format-122)%24;return {website:Math.floor(value/6),staged:value%6>=3,owners:value%3,publication:(format-122)%48>=24,transfers:(format-122)%96>=48,...((format-122)%192>=96?{permissions:true}:{}),...((format-122)%384>=192?{sourceSelections:true}:{}),...((format-122)%768>=384?{nestedAttempts:true}:{}),...((format-122)%1536>=768?{ownerDirectories:true}:{}),...((format-122)%3072>=1536?{portability:true}:{}),...((format-122)%6144>=3072?{templateInheritance:true}:{}),...((format-122)%12288>=6144?{pagedResearchTables:true}:{}),...((format-122)%24576>=12288?{nativeNumericalModels:true}:{}),...((format-122)%49152>=24576?{nativeClockModels:true}:{}),...((format-122)%98304>=49152?{retainedFigures:true}:{}),...((format-122)%196608>=98304?{referencedCalculations:true}:{}),...((format-122)%393216>=196608?{reviewFigurePackages:true}:{}),...((format-122)%786432>=393216?{nativeDomainValues:true}:{}),...((format-122)%1572864>=786432?{calculationPolicies:true}:{}),...((format-122)%3145728>=1572864?{clockDerivations:true}:{}),...((format-122)%6291456>=3145728?{figureAuthoring:true}:{}),...((format-122)%12582912>=6291456?{intervalUncertainty:true}:{}),...((format-122)%25165824>=12582912?{datasetResourcePolicies:true}:{}),...((format-122)%50331648>=25165824?{windowCalculations:true}:{}),...((format-122)%100663296>=50331648?{figureProjectionPolicies:true}:{}),...((format-122)%201326592>=100663296?{calculatorDatasetResults:true}:{}),...((format-122)%402653184>=201326592?{measurementScalarPolicies:true}:{}),...((format-122)%805306368>=402653184?{domainAlgebra:true}:{}),...((format-122)%1610612736>=805306368?{structuredCalculator:true}:{}),...((format-122)%3221225472>=1610612736?{approximateCalculator:true}:{}),...((format-122)%6442450944>=3221225472?{clockSynchronization:true}:{}),...((format-122)%12884901888>=6442450944?{tensorValues:true}:{}),...((format-122)%25769803776>=12884901888?{quantileAggregation:true}:{}),...((format-122)%51539607552>=25769803776?{axisPermutation:true}:{}),...((format-122)%103079215104>=51539607552?{pairedStatistics:true}:{}),...(format>=103079215226?{statisticalUncertainty:true}:{})};
}
export const catalogueRequiresConfigurationDocuments=format=>configurationCatalogueFeatures(format)!==null;
export function configurationCatalogueGeneration({website,staged,owners,publication,transfers,permissions=false,sourceSelections=false,nestedAttempts=false,ownerDirectories=false,portability=false,templateInheritance=false,pagedResearchTables=false,nativeNumericalModels=false,nativeClockModels=false,retainedFigures=false,referencedCalculations=false,reviewFigurePackages=false,nativeDomainValues=false,calculationPolicies=false,clockDerivations=false,figureAuthoring=false,intervalUncertainty=false,datasetResourcePolicies=false,windowCalculations=false,figureProjectionPolicies=false,calculatorDatasetResults=false,measurementScalarPolicies=false,domainAlgebra=false,structuredCalculator=false,approximateCalculator=false,clockSynchronization=false,tensorValues=false,quantileAggregation=false,axisPermutation=false,pairedStatistics=false,statisticalUncertainty=false}){
 if(typeof publication!=='boolean'||typeof transfers!=='boolean'||typeof permissions!=='boolean'||typeof sourceSelections!=='boolean'||typeof nestedAttempts!=='boolean'||typeof ownerDirectories!=='boolean'||typeof portability!=='boolean'||typeof templateInheritance!=='boolean'||typeof pagedResearchTables!=='boolean'||typeof nativeNumericalModels!=='boolean'||typeof nativeClockModels!=='boolean'||typeof retainedFigures!=='boolean'||typeof referencedCalculations!=='boolean'||typeof reviewFigurePackages!=='boolean'||typeof nativeDomainValues!=='boolean'||typeof calculationPolicies!=='boolean'||typeof clockDerivations!=='boolean'||typeof figureAuthoring!=='boolean'||typeof intervalUncertainty!=='boolean'||typeof datasetResourcePolicies!=='boolean'||typeof windowCalculations!=='boolean'||typeof figureProjectionPolicies!=='boolean'||typeof calculatorDatasetResults!=='boolean'||typeof measurementScalarPolicies!=='boolean'||typeof domainAlgebra!=='boolean'||typeof structuredCalculator!=='boolean'||typeof approximateCalculator!=='boolean'||typeof clockSynchronization!=='boolean'||typeof tensorValues!=='boolean'||typeof quantileAggregation!=='boolean'||typeof axisPermutation!=='boolean'||typeof pairedStatistics!=='boolean'||typeof statisticalUncertainty!=='boolean')throw new AppError('INVALID');
 return publicationCatalogueGeneration({website,staged,owners})+72+(publication?24:0)+(transfers?48:0)+(permissions?96:0)+(sourceSelections?192:0)+(nestedAttempts?384:0)+(ownerDirectories?768:0)+(portability?1536:0)+(templateInheritance?3072:0)+(pagedResearchTables?6144:0)+(nativeNumericalModels?12288:0)+(nativeClockModels?24576:0)+(retainedFigures?49152:0)+(referencedCalculations?98304:0)+(reviewFigurePackages?196608:0)+(nativeDomainValues?393216:0)+(calculationPolicies?786432:0)+(clockDerivations?1572864:0)+(figureAuthoring?3145728:0)+(intervalUncertainty?6291456:0)+(datasetResourcePolicies?12582912:0)+(windowCalculations?25165824:0)+(figureProjectionPolicies?50331648:0)+(calculatorDatasetResults?100663296:0)+(measurementScalarPolicies?201326592:0)+(domainAlgebra?402653184:0)+(structuredCalculator?805306368:0)+(approximateCalculator?1610612736:0)+(clockSynchronization?3221225472:0)+(tensorValues?6442450944:0)+(quantileAggregation?12884901888:0)+(axisPermutation?25769803776:0)+(pairedStatistics?51539607552:0)+(statisticalUncertainty?103079215104:0);
}
export async function requireConfigurationDocuments(db){
 const previous=await catalogueFormat(db);if(catalogueRequiresConfigurationDocuments(previous))return;
 const domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));
 const features={website:catalogueRequiresWebsitePresentation(previous)?3:catalogueRequiresWebsiteEditor(previous)?2:catalogueRequiresWebsites(previous)?1:0,staged:catalogueRequiresStagedEvidence(previous),owners:catalogueRequiresSettings(previous)?2:domains?1:0,publication:catalogueRequiresPublicationDocuments(previous),transfers:catalogueRequiresRecordOwnerTransfers(previous)};
 await requireRetiredProjectRecords(db);return requireCatalogueFormat(db,configurationCatalogueGeneration(features));
}
export async function restoreConfigurationCatalogueFormat(db,format){
 const features=configurationCatalogueFeatures(format);if(!features)throw new AppError('CATALOGUE_DAMAGED');
 if(features.owners===2)await requireWorkspaceSettings(db);else if(features.owners===1)await requireWorkspaceDomains(db);
 if(features.website===3)await requireWebsitePresentation(db);else if(features.website===2)await requireWebsiteEditor(db);else if(features.website===1)await requireWebsiteDocuments(db);
 if(features.staged)await requireStagedEvidence(db);if(features.publication)await requirePublicationDocuments(db);if(features.transfers)await requireRecordOwnerTransfers(db);await requireConfigurationDocuments(db);if(features.permissions)await requireSourcePublicationControls(db);if(features.sourceSelections)await requireWebsiteSourceSelections(db);if(features.nestedAttempts)await requireNestedAttemptCollections(db);if(features.ownerDirectories)await requireOwnerDirectories(db);if(features.portability)await requirePortabilityCollections(db);if(features.templateInheritance)await requireCatalogueFormat(db,configurationCatalogueGeneration({...configurationCatalogueFeatures(await catalogueFormat(db)),templateInheritance:true}));if(features.pagedResearchTables)await requirePagedResearchTables(db);if(features.nativeNumericalModels)await requireNativeNumericalModels(db);if(features.nativeClockModels)await requireNativeClockModels(db);if(features.retainedFigures)await requireRetainedFigures(db);if(features.referencedCalculations)await requireReferencedCalculations(db);if(features.reviewFigurePackages)await requireReviewFigurePackages(db);if(features.nativeDomainValues)await requireNativeDomainValues(db);if(features.calculationPolicies)await requireCalculationPolicies(db);if(features.clockDerivations)await requireClockDerivations(db);if(features.figureAuthoring)await requireFigureAuthoring(db);if(features.intervalUncertainty)await requireIntervalUncertainty(db);if(features.datasetResourcePolicies)await requireDatasetResourcePolicies(db);if(features.windowCalculations)await requireWindowCalculations(db);if(features.figureProjectionPolicies)await requireFigureProjectionPolicies(db);if(features.calculatorDatasetResults)await requireCalculatorDatasetResults(db);if(features.measurementScalarPolicies)await requireMeasurementScalarPolicies(db);if(features.domainAlgebra)await requireDomainAlgebra(db);if(features.structuredCalculator)await requireStructuredCalculator(db);if(features.approximateCalculator)await requireApproximateCalculator(db);if(features.clockSynchronization)await requireClockSynchronization(db);if(features.tensorValues)await requireTensorValues(db);if(features.quantileAggregation)await requireQuantileAggregation(db);if(features.axisPermutation)await requireAxisPermutation(db);if(features.pairedStatistics)await requirePairedStatistics(db);if(features.statisticalUncertainty)await requireStatisticalUncertainty(db);
 if(await catalogueFormat(db)!==format)throw new AppError('CATALOGUE_DAMAGED');
}

export const catalogueRequiresSourcePublicationControls=format=>configurationCatalogueFeatures(format)?.permissions===true;
export async function requireSourcePublicationControls(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.permissions)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,permissions:true}));
}

// Source collections remain in the same encrypted website document. The gate
// prevents earlier capped readers from discarding a larger saved selection.
export const catalogueRequiresWebsiteSourceSelections=format=>configurationCatalogueFeatures(format)?.sourceSelections===true;
export async function requireWebsiteSourceSelections(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.sourceSelections)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,sourceSelections:true}));
}

// Preparation rows and their draft command receipts use the existing retained
// record trees. Capped readers must refuse these larger collections on open.
export const catalogueRequiresNestedAttemptCollections=format=>configurationCatalogueFeatures(format)?.nestedAttempts===true;
export async function requireNestedAttemptCollections(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.nestedAttempts)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,nestedAttempts:true}));
}

// Native owner directories authenticate indexed membership and adoption receipts
// in the existing catalogue. The marker and verifier must agree before use.
export const catalogueRequiresOwnerDirectories=format=>configurationCatalogueFeatures(format)?.ownerDirectories===true;
export async function requireOwnerDirectories(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.ownerDirectories)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,ownerDirectories:true}));
}

// Indexed portability controls are admitted with the encrypted native pages.
export const catalogueRequiresPortabilityCollections=format=>configurationCatalogueFeatures(format)?.portability===true;
export async function requirePortabilityCollections(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.portability)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,portability:true}));
}

// Linked templates retain immutable baselines inside the website native tree.
// Old writers must refuse the catalogue before discarding those bindings.
export const catalogueRequiresWebsiteTemplateInheritance=format=>configurationCatalogueFeatures(format)?.templateInheritance===true;
export async function requireWebsiteTemplateInheritance(db){
 await requireWebsitePresentation(db);await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.templateInheritance)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,templateInheritance:true}));
}

// Paged cells and retained table queries share immutable source locators.
export const catalogueRequiresPagedResearchTables=format=>configurationCatalogueFeatures(format)?.pagedResearchTables===true;
export async function requirePagedResearchTables(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.pagedResearchTables)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,pagedResearchTables:true}));
}

// Versioned numerical recipes, declared units and indexed plot receipts must
// remain interpretable together through editing, copying and fresh-key recovery.
export const catalogueRequiresNativeNumericalModels=format=>configurationCatalogueFeatures(format)?.nativeNumericalModels===true;
export async function requireNativeNumericalModels(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.nativeNumericalModels)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,nativeNumericalModels:true}));
}

// Declared counter moduli and rates must not be discarded by earlier editors.
export const catalogueRequiresNativeClockModels=format=>configurationCatalogueFeatures(format)?.nativeClockModels===true;
export async function requireNativeClockModels(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.nativeClockModels)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,nativeClockModels:true}));
}

export const catalogueRequiresRetainedFigures=format=>configurationCatalogueFeatures(format)?.retainedFigures===true;
export async function requireRetainedFigures(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.retainedFigures)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,retainedFigures:true}));
}

export const catalogueRequiresReferencedCalculations=format=>configurationCatalogueFeatures(format)?.referencedCalculations===true;
export async function requireReferencedCalculations(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.referencedCalculations)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,referencedCalculations:true}));
}

// Signed review streams retain an authenticated closure of selected figures.
// Figure-aware apps predating this packet format must also refuse the store.
export const catalogueRequiresReviewFigurePackages=format=>configurationCatalogueFeatures(format)?.reviewFigurePackages===true;
export async function requireReviewFigurePackages(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.reviewFigurePackages)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,reviewFigurePackages:true}));
}

// Structured numerical codecs pin their schema and component representation.
// Earlier applications must not treat a structured value as a scalar or text.
export const catalogueRequiresNativeDomainValues=format=>configurationCatalogueFeatures(format)?.nativeDomainValues===true;
export async function requireNativeDomainValues(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.nativeDomainValues)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,nativeDomainValues:true}));
}

// Retained calculation precision and execution policies must survive every reader.
export const catalogueRequiresCalculationPolicies=format=>configurationCatalogueFeatures(format)?.calculationPolicies===true;
export async function requireCalculationPolicies(db){
 if(catalogueRequiresCalculationPolicies(await catalogueFormat(db)))return;
 // Independent domain writers may already hold read locks on this catalogue.
 // Never wait for a lock conversion: unwind and retry at the request boundary.
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}
 catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.calculationPolicies)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,calculationPolicies:true}));
}

// Derived clock intervals retain declared transition rules and adjacent source cells.
export const catalogueRequiresClockDerivations=format=>configurationCatalogueFeatures(format)?.clockDerivations===true;
export async function requireClockDerivations(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.clockDerivations)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,clockDerivations:true}));
}

// Incomplete authored data exists only in recoverable selected figure drafts.
export const catalogueRequiresFigureAuthoring=format=>configurationCatalogueFeatures(format)?.figureAuthoring===true;
export async function requireFigureAuthoring(db){
 if(catalogueRequiresFigureAuthoring(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}
 catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.figureAuthoring)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,figureAuthoring:true}));
}

// Explicit uncertainty methods and interpreted interval cells travel together.
export const catalogueRequiresIntervalUncertainty=format=>configurationCatalogueFeatures(format)?.intervalUncertainty===true;
export async function requireIntervalUncertainty(db){
 if(catalogueRequiresIntervalUncertainty(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}
 catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.intervalUncertainty)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,intervalUncertainty:true}));
}

// Explicit dataset execution budgets are part of the immutable calculation
// contract. Earlier engines must not replace them with their own defaults.
export const catalogueRequiresDatasetResourcePolicies=format=>configurationCatalogueFeatures(format)?.datasetResourcePolicies===true;
export async function requireDatasetResourcePolicies(db){
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.datasetResourcePolicies)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,datasetResourcePolicies:true}));
}

// Explicit retained-row window interpretations must survive older-reader refusal.
export const catalogueRequiresWindowCalculations=format=>configurationCatalogueFeatures(format)?.windowCalculations===true;
export async function requireWindowCalculations(db){
 if(catalogueRequiresWindowCalculations(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.windowCalculations)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,windowCalculations:true}));
}

// Saved plot policies and source-independent affine projection descriptors.
export const catalogueRequiresFigureProjectionPolicies=format=>configurationCatalogueFeatures(format)?.figureProjectionPolicies===true;
export async function requireFigureProjectionPolicies(db){
 if(catalogueRequiresFigureProjectionPolicies(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.figureProjectionPolicies)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,figureProjectionPolicies:true}));
}

// Exact calculator snapshots and their one-row results form one retained contract.
export const catalogueRequiresCalculatorDatasetResults=format=>configurationCatalogueFeatures(format)?.calculatorDatasetResults===true;
export async function requireCalculatorDatasetResults(db){
 if(catalogueRequiresCalculatorDatasetResults(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.calculatorDatasetResults)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,calculatorDatasetResults:true}));
}

// Owned numerical interpretations and their compact scalar text dependencies.
export const catalogueRequiresMeasurementScalarPolicies=format=>configurationCatalogueFeatures(format)?.measurementScalarPolicies===true;
export async function requireMeasurementScalarPolicies(db){
 if(catalogueRequiresMeasurementScalarPolicies(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.measurementScalarPolicies)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,measurementScalarPolicies:true}));
}

// Versioned exact domain arithmetic remains independently recognizable by old readers.
export const catalogueRequiresDomainAlgebra=format=>configurationCatalogueFeatures(format)?.domainAlgebra===true;
export async function requireDomainAlgebra(db){
 if(catalogueRequiresDomainAlgebra(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.domainAlgebra)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,domainAlgebra:true}));
}

// Standalone structured calculation semantics are independent of graph algebra.
export const catalogueRequiresStructuredCalculator=format=>configurationCatalogueFeatures(format)?.structuredCalculator===true;
export async function requireStructuredCalculator(db){
 if(catalogueRequiresStructuredCalculator(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.structuredCalculator)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,structuredCalculator:true}));
}

// Approximate values carry explicit interpretation independently of exact capture.
export const catalogueRequiresApproximateCalculator=format=>configurationCatalogueFeatures(format)?.approximateCalculator===true;
export async function requireApproximateCalculator(db){
 if(catalogueRequiresApproximateCalculator(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.approximateCalculator)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,approximateCalculator:true}));
}

// Explicit pinned two-anchor clock synchronization is independently recognizable.
export const catalogueRequiresClockSynchronization=format=>configurationCatalogueFeatures(format)?.clockSynchronization===true;
export async function requireClockSynchronization(db){
 if(catalogueRequiresClockSynchronization(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.clockSynchronization)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,clockSynchronization:true}));
}

// Rank-three and higher tensor interpretation and explicit structural reshaping.
export const catalogueRequiresTensorValues=format=>configurationCatalogueFeatures(format)?.tensorValues===true;
export async function requireTensorValues(db){
 if(catalogueRequiresTensorValues(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.tensorValues)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,tensorValues:true}));
}

// Explicit quantile method, retained probability and auditable rank selection.
export const catalogueRequiresQuantileAggregation=format=>configurationCatalogueFeatures(format)?.quantileAggregation===true;
export async function requireQuantileAggregation(db){
 if(catalogueRequiresQuantileAggregation(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.quantileAggregation)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,quantileAggregation:true}));
}

// Explicit axis permutation retains the pinned structural mapping independently.
export const catalogueRequiresAxisPermutation=format=>configurationCatalogueFeatures(format)?.axisPermutation===true;
export async function requireAxisPermutation(db){
 if(catalogueRequiresAxisPermutation(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.axisPermutation)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,axisPermutation:true}));
}

// Complete-pair covariance and linear fits retain exact estimators and statuses.
export const catalogueRequiresPairedStatistics=format=>configurationCatalogueFeatures(format)?.pairedStatistics===true;
export async function requirePairedStatistics(db){
 if(catalogueRequiresPairedStatistics(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.pairedStatistics)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,pairedStatistics:true}));
}

// Explicit covariance models and their complete propagation receipts remain owned.
export const catalogueRequiresStatisticalUncertainty=format=>configurationCatalogueFeatures(format)?.statisticalUncertainty===true;
export async function requireStatisticalUncertainty(db){
 if(catalogueRequiresStatisticalUncertainty(await catalogueFormat(db)))return;
 try{await db.run('LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT');}catch(error){if(error.code==='55P03')throw new AppError('LOCKED');throw error;}
 await requireConfigurationDocuments(db);const features=configurationCatalogueFeatures(await catalogueFormat(db));
 if(!features.statisticalUncertainty)await requireCatalogueFormat(db,configurationCatalogueGeneration({...features,statisticalUncertainty:true}));
}
