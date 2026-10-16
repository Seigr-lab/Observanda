import {websiteDefaults} from './web/website-model.js';
import {upgradeRecord} from './web/record-model.js';
import { randomUUID } from 'node:crypto';
import { createNotebook } from './model.js';

// Fictional examples for appearance preview and automated verification only.
export function sampleNotebook() {
  const book = createNotebook('A closer look', 'Small experiments in the everyday. A lab book of questions, careful observations, and unexpected connections.');
  book.website.home=websiteDefaults().home;
  const projectId=randomUUID();
  book.projects=[{id:projectId,title:'Patterns in the everyday',description:'',share:true,logoId:null}];
  book.notebooks=[{id:randomUUID(),projectId,title:'Field journal'}];
  const shared = { notebookId: book.notebooks[0].id, author: 'A curious observer', occurredOn: '2026-09-20', createdAt: book.createdAt, updatedAt: book.updatedAt, share: true, chart: null, status: 'draft', sections: [], attachments: [] };
  book.entries = [
    { ...shared, id: randomUUID(), type: 'observation', title: 'Watching a seed unfold', body: 'A small question: how does a seedling change over its first few days?\n\nThis is fictional sample content for exploring your lab book’s appearance. In a real entry, record the conditions, what you observed, and anything that might have affected the result.\n\nThe measurements below are illustrative, not experimental evidence.', tags: ['growth', 'sample'], chart: { title: 'Illustrative seedling height', kind: 'line', xLabel: 'Observation day', yLabel: 'Height (mm)', points: [{ label: '1', value: 3 }, { label: '2', value: 5 }, { label: '3', value: 8 }, { label: '4', value: 12 }, { label: '5', value: 17 }] } },
    { ...shared, id: randomUUID(), occurredOn: '2026-09-19', type: 'hypothesis', title: 'Does paper change the color we see?', body: 'Would the same pigment appear warmer on unbleached paper?\n\nA possible experiment: compare one pigment on two papers under the same light. Keep a record of the materials, and photograph the results together.\n\nAn unanswered question belongs in a lab book too.', tags: ['color', 'sample'] },
    { ...shared, id: randomUUID(), occurredOn: '2026-09-18', type: 'note', title: 'Listening to the room', body: 'The room sounds different with the curtains closed.\n\nBefore explaining why, I want to record the conditions and repeat the observation. What else changed between the two listening sessions?', tags: ['sound', 'sample'], share: false }
  ];
  book.entries=book.entries.map(upgradeRecord);
  return book;
}
