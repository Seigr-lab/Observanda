import {contentBuffer} from '../src/file-content.js';
import {readPublicationRecord} from '../src/publication-input.js';
import {selectEditionRecord} from '../src/web/publication-selection.js';
export async function publicationText(candidate){let text='';for(const [name,content] of candidate.files)if(/\.(html|css|csv|svg|json)$/.test(name))text+=(await contentBuffer(content)).toString('utf8');return text;}
export async function publicationInputBook(workspace,source){const entries=[];for(const row of source.records)entries.push(selectEditionRecord(await readPublicationRecord(workspace,source,row),row.selection));return {...source.metadata,entries};}
