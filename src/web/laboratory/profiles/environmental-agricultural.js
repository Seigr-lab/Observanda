export default {
  "id": "environmental-agricultural",
  "version": 1,
  "label": "Environmental & agricultural",
  "description": "Sites, field campaigns, soil, water, crops and observations.",
  "icon": "leaf",
  "sections": [
    {
      "key": "sites",
      "label": "Sites & plots",
      "description": "Describe location, sampling context and plot history.",
      "fields": [
        {
          "key": "field1",
          "label": "Site reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Location / depth",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "campaigns",
      "label": "Sampling campaigns",
      "description": "Define study questions, sampling design and quality objectives.",
      "fields": [
        {
          "key": "field1",
          "label": "Campaign reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Quality objectives",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "observations",
      "label": "Field & crop observations",
      "description": "Record environmental conditions, treatments and observations.",
      "fields": [
        {
          "key": "field1",
          "label": "Plot reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Season / treatment",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "results",
      "label": "Measurements & interpretation",
      "description": "Connect methods, units, detection limits and interpretation.",
      "fields": [
        {
          "key": "field1",
          "label": "Method reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Units / qualifiers",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
