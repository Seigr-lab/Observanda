import messages from './locales/en/recordEditors.json' with {type:'json'};
import {bookText} from './book-messages.js';
export const RECORD_TYPES = [
  ...['concept','decision'].map(id=>({id,label:messages['type_'+id+'_label'],description:messages['type_'+id+'_description'],sections:Array.from({length:id==='concept'?3:4},(_,i)=>bookText(id+'Section'+(i+1)))})),
  { id: 'run', label: messages.type_run_label, description: messages.type_run_description, sections: ['Purpose and planned changes', 'Parameters and conditions', 'Preparation', 'Execution or performance', 'Acquisition and recovery', 'Observed deviations', 'Results', 'Interpretation and limitations'] },
  { id: 'experiment', label: messages.type_experiment_label, description: messages.type_experiment_description, sections: ['Question and objectives', 'Rationale and alternatives', 'Hypothesis', 'Materials and conditions', 'Method', 'Assessment criteria', 'Results', 'Interpretation and limitations'] },
  { id: 'observation', label: messages.type_observation_label, description: messages.type_observation_description, sections: ['Context and conditions', 'Observations', 'Questions and follow-up'] },
  { id: 'hypothesis', label: messages.type_hypothesis_label, description: messages.type_hypothesis_description, sections: ['Statement', 'Rationale', 'Predictions', 'Test plan'] },
  { id: 'protocol', label: messages.type_protocol_label, description: messages.type_protocol_description, sections: ['Purpose', 'Materials and equipment', 'Procedure', 'Controls and quality checks', 'Safety and disposal'] },
  { id: 'analysis', label: messages.type_analysis_label, description: messages.type_analysis_description, sections: ['Question', 'Data and provenance', 'Analysis method', 'Findings and uncertainty', 'Limitations'] },
  { id: 'dataset', label: messages.type_dataset_label, description: messages.type_dataset_description, sections: ['Data description', 'Collection method', 'Variables and units', 'Quality and exclusions'] },
  { id: 'conclusion', label: messages.type_conclusion_label, description: messages.type_conclusion_description, sections: ['Supporting evidence', 'Conclusion', 'Limitations', 'Next steps'] },
  { id: 'reference', label: messages.type_reference_label, description: messages.type_reference_description, sections: ['Citation and source', 'Notes', 'Relevance'] },
  { id: 'note', label: messages.type_note_label, description: messages.type_note_description, sections: [] }
];
export const STATUSES = ['draft', 'planned', 'in progress', 'completed', 'failed', 'incomplete', 'inconclusive', 'cancelled'];
export const recordLabel = type => RECORD_TYPES.find(item => item.id === type)?.label ?? type;
