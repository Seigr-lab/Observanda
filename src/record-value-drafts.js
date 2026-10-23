import {hasPlotResourceFigure,hasPlotResourceFigures,plotResourceFigureDocument} from './plot-resource-format.js';
import {requireFigureProjectionPolicies,catalogueRequiresFigureProjectionPolicies} from './catalogue-format.js';
import {allFigurePlots} from './web/figure-provenance.js';
import {hasAuthoredFigure} from './figure-authoring-format.js';
import {requireFigureAuthoring,catalogueRequiresFigureAuthoring} from './catalogue-format.js';
import {hasRetainedFigure} from './record-retained-figures.js';
import {requireRetainedFigures,catalogueRequiresRetainedFigures} from './catalogue-format.js';
import {hasFigureProjection} from './record-numerical-models.js';
import {requireNativeNumericalModels,catalogueRequiresNativeNumericalModels} from './catalogue-format.js';
import {hasPagedResultTables} from './retained-tables.js';
import {hasNestedPreparationContinuations} from './web/attempt-model.js';
import {AppError} from './errors.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections} from './catalogue-format.js';
import {verifyPreparationDraft} from './record-preparation-drafts.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {SelectedRecordDrafts} from './record-selected-drafts.js';
import {validRecordValueBase,validRecordValue} from './web/record-value-model.js';
import {requireNestedAttemptCollections,requireSelectedValueDrafts,requireRecordTypeDrafts,requireFigureCopyDrafts,requirePagedResearchTables,catalogueRequiresPagedResearchTables} from './catalogue-format.js';
import {selectedRecordValue,replaceRecordValue} from './record-values.js';
import {validateFigureCopyPlans} from './record-figure-copy-values.js';
const specification={name:'selection',version:6,validBase:validRecordValueBase,validValue:(value,base)=>validRecordValue(value,base.field),requireFormat:async(db,selection,value)=>{if(selection.field.startsWith('figure:')&&hasAuthoredFigure(value.value))await requireFigureAuthoring(db);
if(selection.field.startsWith('figure:')&&hasFigureProjection(value.value))await requireNativeNumericalModels(db);
if(selection.field.startsWith('figure:')&&hasPlotResourceFigure(value.value))await requireFigureProjectionPolicies(db);
 if(selection.field.startsWith('figure:')&&hasRetainedFigure(value.value))await requireRetainedFigures(db);await (attemptValueField(selection.field)?.kind==='preparation'&&hasNestedPreparationContinuations(value.value)?requireNestedAttemptCollections(db):value.copies?requireFigureCopyDrafts(db):selection.field==='type'?requireRecordTypeDrafts(db):requireSelectedValueDrafts(db));if(selection.field.startsWith('result:')&&hasPagedResultTables({statements:[value.value]}))await requirePagedResearchTables(db);},
 extras:value=>value.copies?{figureCopies:value.copies}:{},savedExtras:draft=>draft.figureCopies?{figureCopies:draft.figureCopies}:{},restore:(draft,value)=>draft.figureCopies?{...value,copies:draft.figureCopies}:value,validateExtras:validateFigureCopyPlans,
 async select(document,base){const selected=await selectedRecordValue(document,base.field);return {...selected,replace:(target,value)=>replaceRecordValue(target,base.field,value)};}
};
export class RecordValueDrafts extends SelectedRecordDrafts{constructor(workspace){super(workspace,specification);}async verify(store,draft){const result=await (draft.preparationEdit?verifyPreparationDraft(store,draft):super.verify(store,draft));if(attemptValueField(draft.selection.field)?.kind==='preparation'&&hasNestedPreparationContinuations(result.value.value)&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');if(draft.selection.field.startsWith('result:')&&hasPagedResultTables({statements:[result.value.value]})&&!catalogueRequiresPagedResearchTables(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');if(draft.selection.field.startsWith('figure:')&&hasFigureProjection(result.value.value)&&!catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');if(draft.selection.field.startsWith('figure:')&&hasPlotResourceFigure(result.value.value)&&!catalogueRequiresFigureProjectionPolicies(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');
 if(draft.selection.field.startsWith('figure:')&&hasRetainedFigure(result.value.value)&&!catalogueRequiresRetainedFigures(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');if(draft.selection.field.startsWith('figure:')&&hasAuthoredFigure(result.value.value)){if(!catalogueRequiresFigureAuthoring(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');const {RetainedFigureAuthoring}=await import('./retained-figure-authoring.js');const authoring=new RetainedFigureAuthoring(store.workspace,{readOnly:true});for(const figure of allFigurePlots([result.value.value]))if(figure.kind==='retained'&&hasAuthoredFigure(figure))await authoring.verify(figure);}return result;}}
export async function verifyRecordValueDraft(store,draft){return new RecordValueDrafts(store.workspace).verify(store,draft);}
