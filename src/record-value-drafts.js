import {SelectedRecordDrafts} from './record-selected-drafts.js';
import {validRecordValueBase,validRecordValue} from './web/record-value-model.js';
import {requireSelectedValueDrafts,requireRecordTypeDrafts,requireFigureCopyDrafts} from './catalogue-format.js';
import {selectedRecordValue,replaceRecordValue} from './record-values.js';
import {validateFigureCopyPlans} from './record-figure-copy-values.js';
const specification={name:'selection',version:6,validBase:validRecordValueBase,validValue:(value,base)=>validRecordValue(value,base.field),requireFormat:(db,selection,value)=>value.copies?requireFigureCopyDrafts(db):selection.field==='type'?requireRecordTypeDrafts(db):requireSelectedValueDrafts(db),
 extras:value=>value.copies?{figureCopies:value.copies}:{},savedExtras:draft=>draft.figureCopies?{figureCopies:draft.figureCopies}:{},restore:(draft,value)=>draft.figureCopies?{...value,copies:draft.figureCopies}:value,validateExtras:validateFigureCopyPlans,
 async select(document,base){const selected=await selectedRecordValue(document,base.field);return {...selected,replace:(target,value)=>replaceRecordValue(target,base.field,value)};}
};
export class RecordValueDrafts extends SelectedRecordDrafts{constructor(workspace){super(workspace,specification);}}
export async function verifyRecordValueDraft(store,draft){return new RecordValueDrafts(store.workspace).verify(store,draft);}
