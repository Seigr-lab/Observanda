import {SelectedRecordDrafts} from './record-selected-drafts.js';
import {validWritingBase,validWritingValue,writingSectionValue} from './web/record-writing-model.js';
import {catalogueFormat,catalogueRequiresSemanticRecordStyles,requireSemanticRecordStyles,requireDraftDocuments,requireSourcePublicationControls} from './catalogue-format.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {AppError} from './errors.js';
const specification={name:'writing',version:5,validBase:validWritingBase,validValue:(value,base)=>validWritingValue(value,base.sectionId),
 async requireFormat(db,selection,value){
  await (Object.hasOwn(value,'share')?requireSourcePublicationControls(db):requireDraftDocuments(db));
  if(value.body?.attrs?.semanticStyles)await requireSemanticRecordStyles(db);
 },
 async select(document,base,{row,store}){
  const index=base.sectionId===null?null:await new RecordMemberCollections(store).position(row,'sections',base.sectionId);if(index===-1)throw new AppError('MISSING');
  const path=index===null?['body']:['sections',String(index)],selected=(await document.field(path)).value;
  if(index!==null&&selected?.id!==base.sectionId)throw new AppError('CATALOGUE_DAMAGED');
  return {value:index===null?{body:selected}:writingSectionValue(selected),replace:(target,value)=>target.replace(path,index===null?value.body:{...selected,...value})};
 }
};
export class RecordWritingDrafts extends SelectedRecordDrafts{constructor(workspace){super(workspace,specification);}}
export async function verifyWritingDraft(store,draft){
 const {value}=await new RecordWritingDrafts(store.workspace).verify(store,draft);
 if(value.body?.attrs?.semanticStyles&&!catalogueRequiresSemanticRecordStyles(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');
 return value;
}
