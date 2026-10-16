export default {
  "id": "crime-forensic",
  "version": 1,
  "label": "Crime & forensic",
  "description": "Case work, examination plans and evidence documentation.",
  "icon": "search",
  "sections": [
    {
      "key": "cases",
      "label": "Cases & requests",
      "description": "Record scoped case references and examination questions.",
      "fields": [
        {
          "key": "field1",
          "label": "Case reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Examination request",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "evidence",
      "label": "Evidence documentation",
      "description": "Describe evidence references and preservation context.",
      "fields": [
        {
          "key": "field1",
          "label": "Evidence reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Storage reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "examinations",
      "label": "Examination notes",
      "description": "Connect method versions, observations and supporting artifacts.",
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
          "label": "Artifact reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "reports",
      "label": "Review & reporting",
      "description": "Document review questions, limitations and report references.",
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
          "label": "Limitations",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
