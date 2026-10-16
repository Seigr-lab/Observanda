import {bookText} from './book-messages.js';
export const RECORD_TYPES = [
  ...['concept','decision'].map(id=>({id,label:bookText(id+'Label'),description:bookText(id+'Description'),sections:Array.from({length:id==='concept'?3:4},(_,i)=>bookText(id+'Section'+(i+1)))})),
  { id: 'run', label: 'Run or take', description: 'An individual attempt, session or material study using a linked method. Keep each attempt and its outcome.', sections: ['Purpose and planned changes', 'Parameters and conditions', 'Preparation', 'Execution or performance', 'Acquisition and recovery', 'Observed deviations', 'Results', 'Interpretation and limitations'] },
  { id: 'experiment', label: 'Experiment', description: 'Plan a test, record the method, and keep results separate from interpretation.', sections: ['Question and objectives', 'Rationale and alternatives', 'Hypothesis', 'Materials and conditions', 'Method', 'Assessment criteria', 'Results', 'Interpretation and limitations'] },
  { id: 'observation', label: 'Observation', description: 'Record what happened, with context and evidence in any medium.', sections: ['Context and conditions', 'Observations', 'Questions and follow-up'] },
  { id: 'hypothesis', label: 'Hypothesis', description: 'State an explanation, predictions, and how you could test it.', sections: ['Statement', 'Rationale', 'Predictions', 'Test plan'] },
  { id: 'protocol', label: 'Protocol', description: 'Write a reusable method with materials, steps, and quality checks.', sections: ['Purpose', 'Materials and equipment', 'Procedure', 'Controls and quality checks', 'Safety and disposal'] },
  { id: 'analysis', label: 'Analysis', description: 'Connect data and methods to findings, uncertainty, and limitations.', sections: ['Question', 'Data and provenance', 'Analysis method', 'Findings and uncertainty', 'Limitations'] },
  { id: 'dataset', label: 'Dataset record', description: 'Describe measurements, units, collection methods, and data quality.', sections: ['Data description', 'Collection method', 'Variables and units', 'Quality and exclusions'] },
  { id: 'conclusion', label: 'Conclusion', description: 'Explain what the evidence supports and what remains unresolved.', sections: ['Supporting evidence', 'Conclusion', 'Limitations', 'Next steps'] },
  { id: 'reference', label: 'Reference', description: 'Keep a citation, source notes, and its relevance to your work.', sections: ['Citation and source', 'Notes', 'Relevance'] },
  { id: 'note', label: 'Free-form note', description: 'Start with an open page. Add your own sections, media, and figures.', sections: [] }
];
export const STATUSES = ['draft', 'planned', 'in progress', 'completed', 'failed', 'incomplete', 'inconclusive', 'cancelled'];
export const recordLabel = type => RECORD_TYPES.find(item => item.id === type)?.label ?? type;
