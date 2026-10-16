export default {
  "id": "biosafety-containment",
  "version": 1,
  "label": "Biosafety & containment",
  "description": "Risk assessment, training, facility assurance and incident documentation.",
  "icon": "shield",
  "sections": [
    {
      "key": "assessments",
      "label": "Risk assessments",
      "description": "Document activity-specific assessment and responsible review.",
      "fields": [
        {
          "key": "field1",
          "label": "Activity reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Assessment version",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "training",
      "label": "Training & competency",
      "description": "Record training evidence, scope and reassessment needs.",
      "fields": [
        {
          "key": "field1",
          "label": "Training scope",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Evidence reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "facilities",
      "label": "Facilities & equipment assurance",
      "description": "Connect inspection and certification records.",
      "fields": [
        {
          "key": "field1",
          "label": "Facility reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Equipment reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "incidents",
      "label": "Incidents & follow-up",
      "description": "Document incidents and corrective actions through local procedures.",
      "fields": [
        {
          "key": "field1",
          "label": "Incident reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Follow-up",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
