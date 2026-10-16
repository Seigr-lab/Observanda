export default {
  "id": "physical-prototyping",
  "version": 1,
  "label": "Physical prototyping",
  "description": "Designs, component lists, PCB assemblies, measurements and rework.",
  "icon": "code",
  "sections": [
    {
      "key": "design",
      "label": "Design & revision",
      "description": "Record the purpose, schematic or mechanical revision and controlled changes. Attach original design files as evidence; link the exact method used.",
      "fields": [
        {
          "key": "field1",
          "label": "Prototype / design revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Question or intended behavior",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Changes from previous revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Schematic / layout / mechanical source revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Electrical and design-rule checks / unresolved issues",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "assembly",
      "label": "Assembly & bill of materials",
      "description": "Identify each physical build. Use Inventory > Bills of materials to plan and reserve components, then record actual use and scrap. DNP means do not populate; it must not consume stock.",
      "fields": [
        {
          "key": "field1",
          "label": "Build / board serial or batch",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Design revision and assembly variant",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Assembly method / tools",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Substitutions and reason",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Inspection / polarity / orientation checks",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "bring-up",
      "label": "Bring-up & measurements",
      "description": "Keep preparation, physical execution and interpretation separate. Record equipment, limits and actual measurements; a design check or simulation alone does not establish a working physical build.",
      "fields": [
        {
          "key": "field1",
          "label": "Build identity",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Test setup / instrument and calibration",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Supply settings and current limit",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Expected readings / acceptance criteria",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Measured readings / units and uncertainty",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field6",
          "label": "Incomplete checks / failures",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "rework",
      "label": "Rework & repeat",
      "description": "Record what changed and why. Retain the original run and BOM; create a new BOM for additional parts and a separate run for the repeated test.",
      "fields": [
        {
          "key": "field1",
          "label": "Build identity / previous run",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Fault and supporting evidence",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Removed / replaced / recovered components",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Modification and reason",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Retest conditions / result",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "findings",
      "label": "Prototype findings",
      "description": "Connect measurements and observed limitations to the design decision. Record open questions without forcing a pass/fail outcome.",
      "fields": [
        {
          "key": "field1",
          "label": "Interpretation / supporting evidence",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Known limitations",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Decision and next revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
