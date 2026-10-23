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
const specification={name:'selection',version:6,validBase:validRecordValueBase,validValue:(value,base)=>validRecordValue(value,base.field),requireFormat:async(db,selection,value)=>{await (attemptValueField(selection.field)?.kind==='preparation'&&hasNestedPreparationContinuations(value.value)?requireNestedAttemptCollections(db):value.copies?requireFigureCopyDrafts(db):selection.field==='type'?requireRecordTypeDrafts(db):requireSelectedValueDrafts(db));if(selection.field.startsWith('result:')&&hasPagedResultTables({statements:[value.value]}))await requirePagedResearchTables(db);},
 extras:value=>value.copies?{figureCopies:value.copies}:{},savedExtras:draft=>draft.figureCopies?{figureCopies:draft.figureCopies}:{},restore:(draft,value)=>draft.figureCopies?{...value,copies:draft.figureCopies}:value,validateExtras:validateFigureCopyPlans,
 async select(document,base){const selected=await selectedRecordValue(document,base.field);return {...selected,replace:(target,value)=>replaceRecordValue(target,base.field,value)};}
};
export class RecordValueDrafts extends SelectedRecordDrafts{constructor(workspace){super(workspace,specification);}async verify(store,draft){const result=await (draft.preparationEdit?verifyPreparationDraft(store,draft):super.verify(store,draft));if(attemptValueField(draft.selection.field)?.kind==='preparation'&&hasNestedPreparationContinuations(result.value.value)&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');if(draft.selection.field.startsWith('result:')&&hasPagedResultTables({statements:[result.value.value]})&&!catalogueRequiresPagedResearchTables(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');return result;}}
export async function verifyRecordValueDraft(store,draft){return new RecordValueDrafts(store.workspace).verify(store,draft);}
