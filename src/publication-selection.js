import {AppError} from './errors.js';
import {recordRevision} from './research.js';
import {publicationOriginal} from './publication-originals.js';
import {validEditionSelection,validEditionRecord} from './web/publication-selection.js';

export function validateEditionSelection(value){if(!validEditionSelection(value))throw new AppError('INVALID');return value;}
export function validateEditionRecord(record,choice){
 if(!choice)return;
 if(!validEditionRecord(choice)||choice.id!==record.id)throw new AppError('INVALID');
 if(choice.revision!==recordRevision(publicationOriginal(record)))throw new AppError('RECORD_CHANGED');
 const contains=(choices,items,key='id')=>choices.every(id=>items.some(item=>item[key]===id));
 if(!contains(choice.sections,record.sections)||!contains(choice.fields,record.template?.fields??[],'key')||!contains(choice.attachments,record.attachments)||!contains(choice.figures.map(f=>f.id),record.figures))throw new AppError('INVALID');
}
