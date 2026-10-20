import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {defaultEditionRecord,selectEditionRecord} from '../src/web/publication-selection.js';
import {websiteRecordShare} from '../src/web/website-selection.js';
import {recordEditionInventory} from '../src/web/publication-inventory.js';
import {publicationDescriptorDetails} from '../src/publication-record-descriptor.js';
import {researchReference} from '../src/web/research-reference.js';

const revision='0'.repeat(64);
test('website and edition overrides only narrow source record and attachment consent',()=>{
 const {record,secret}=selectionBook(),attachment={id:randomUUID(),kind:'image',caption:'Private image caption',alt:'Private alternative text',transcript:'',share:false};record.attachments=[attachment];
 const selection={includeProjects:[],defaultShare:true,records:[{id:secret.id,share:true,attachments:[]}]};
 assert.equal(websiteRecordShare(selection,secret),false);
 assert.equal(selectEditionRecord(secret,{...defaultEditionRecord(secret,revision),include:true}).share,false);
 const chosen=selectEditionRecord(record,{...defaultEditionRecord(record,revision),attachments:[attachment.id]});
 assert.deepEqual(chosen.attachments,[]);assert.deepEqual(recordEditionInventory(record,revision).attachments,[]);
 assert.equal(JSON.stringify(publicationDescriptorDetails(record)).includes(attachment.id),false);
 assert.deepEqual(record.attachments,[attachment]);
});

test('private writing removes its title, nested selectors and outgoing mentions from public derivatives',()=>{
 const {book,record,other}=selectionBook(),section=record.sections[1],anchor=randomUUID();section.share=false;
 section.body={type:'doc',content:[{type:'heading',attrs:{id:anchor,level:2},content:[{type:'text',text:'Private nested heading'}]},{type:'paragraph',content:[{type:'text',text:'Private reference label',marks:[{type:'link',attrs:{href:researchReference({workspaceId:book.id,kind:'record',id:other.id})}}]}]}]};
 const original=structuredClone(record),choice={...defaultEditionRecord(record,revision),sections:record.sections.map(item=>item.id)};
 const selected=selectEditionRecord(record,choice),inventory=recordEditionInventory(record,revision),descriptor=publicationDescriptorDetails(record);
 for(const value of [selected,inventory,descriptor])for(const withheld of [section.id,section.title,anchor,'Private nested heading','Private reference label'])assert.equal(JSON.stringify(value).includes(withheld),false,withheld);
 assert.equal(descriptor.relations.some(link=>link.target.id===other.id),false);assert.deepEqual(record,original);
});

test('older records with no section flag retain their ordinary public writing choices',()=>{
 const {record}=selectionBook(),choice=defaultEditionRecord(record,revision);
 assert.deepEqual(choice.sections,record.sections.map(section=>section.id));
 assert.deepEqual(selectEditionRecord(record).sections,record.sections);
 assert.equal(recordEditionInventory(record,revision).sections.length,record.sections.length);
});
