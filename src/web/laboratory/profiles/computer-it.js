export default {
  "id": "computer-it",
  "version": 1,
  "label": "Computer / IT",
  "description": "Computational experiments, environments, datasets and benchmark evidence.",
  "icon": "code",
  "sections": [
    {
      "key": "environments",
      "label": "Environments & builds",
      "description": "Record software, dependencies, configuration and hardware.",
      "fields": [
        {
          "key": "field1",
          "label": "Repository / revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Environment reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "datasets",
      "label": "Datasets & provenance",
      "description": "Document dataset versions, origin and permitted use.",
      "fields": [
        {
          "key": "field1",
          "label": "Dataset version",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Source / licence",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "runs",
      "label": "Runs & benchmarks",
      "description": "Record inputs, configurations, seeds, outputs and comparisons.",
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
          "label": "Configuration / seed",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "findings",
      "label": "Findings & validation",
      "description": "Connect results, limitations and reproduction instructions.",
      "fields": [
        {
          "key": "field1",
          "label": "Baseline reference",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Reproduction instructions",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
