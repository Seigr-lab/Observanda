export default {
  "id": "analytical-qc",
  "version": 1,
  "label": "Analytical & quality control",
  "description": "Methods, batches, measurements and quality investigations.",
  "icon": "chart",
  "sections": [
    {
      "key": "samples",
      "label": "Samples & batches",
      "description": "Describe material, batch identity and acceptance criteria.",
      "fields": [
        {
          "key": "field1",
          "label": "Batch reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Material",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "methods",
      "label": "Methods & calibration",
      "description": "Connect method versions, calibration records and uncertainty information.",
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
          "label": "Calibration reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "runs",
      "label": "Analytical runs",
      "description": "Record run context, standards and raw-data references.",
      "fields": [
        {
          "key": "field1",
          "label": "Run reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Data location",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "investigations",
      "label": "Quality investigations",
      "description": "Retain original results and document deviations and decisions.",
      "fields": [
        {
          "key": "field1",
          "label": "Issue reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Acceptance criteria",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
