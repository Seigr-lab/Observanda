export default {
  "id": "clinical-medical",
  "version": 1,
  "label": "Clinical & medical",
  "description": "Organize methods, quality work and clinical workflow documentation.",
  "icon": "medical",
  "sections": [
    {
      "key": "requests",
      "label": "Requests & accessioning",
      "description": "Document request and specimen references without copying unnecessary identifying data.",
      "fields": [
        {
          "key": "field1",
          "label": "Request reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Specimen reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "methods",
      "label": "Methods & verification",
      "description": "Describe intended use, method revisions and verification evidence.",
      "fields": [
        {
          "key": "field1",
          "label": "Method version",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Intended use",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "quality",
      "label": "Quality & exceptions",
      "description": "Document controls, issues and follow-up investigations.",
      "fields": [
        {
          "key": "field1",
          "label": "Control reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Issue reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "reports",
      "label": "Reporting & follow-up",
      "description": "Document reporting procedures and follow-up work.",
      "fields": [
        {
          "key": "field1",
          "label": "Report reference",
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
