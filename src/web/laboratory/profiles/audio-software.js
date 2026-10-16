export default {
  "id": "audio-software",
  "version": 1,
  "label": "Audio software & VST",
  "description": "DSP prototypes, reproducible builds, exports, host tests and listening comparisons.",
  "icon": "code",
  "sections": [
    {
      "key": "dsp",
      "label": "DSP prototype",
      "description": "State the signal path, parameter behavior and intended comparison. Keep a prototype or preview separate from an exported plug-in tested in a host.",
      "fields": [
        {
          "key": "field1",
          "label": "Source / project revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Signal path / algorithm",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Parameter values and automation",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Input fixture / reference audio",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Sample rate / block size",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "build",
      "label": "Build & export",
      "description": "Retain the source snapshot, tool versions, build settings, exported binary and build log as evidence. A successful export does not establish correct behavior in every host.",
      "fields": [
        {
          "key": "field1",
          "label": "Source revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Toolchain / SDK versions",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Target platform / architecture / plug-in format",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Build configuration",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Export artifact / version",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field6",
          "label": "Build or export outcome",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "host-test",
      "label": "Host & real-time test",
      "description": "Record validator results and actual host behavior separately. Retain logs and rendered audio; report unsupported or untested combinations explicitly.",
      "fields": [
        {
          "key": "field1",
          "label": "Plug-in binary revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Host / version / operating system",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Audio device / sample rate / buffer size",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Input / output bus layout",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Automation / state save and reload",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field6",
          "label": "Latency / CPU / dropouts",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field7",
          "label": "Validator results / observed host behavior",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "listening",
      "label": "Listening comparison",
      "description": "Describe the question and retain comparable audio examples. State level matching, monitoring and limitations; subjective preference and measured behavior are distinct evidence.",
      "fields": [
        {
          "key": "field1",
          "label": "Versions / settings compared",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Source audio / input level",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Level matching / monitoring",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Listening observations",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field5",
          "label": "Measured differences / uncertainty",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    },
    {
      "key": "release",
      "label": "Release decision",
      "description": "Link the exact export and tests considered. Keep saving, export, validation, host testing and publication as distinct events.",
      "fields": [
        {
          "key": "field1",
          "label": "Selected export revision",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field2",
          "label": "Test coverage / untested hosts",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field3",
          "label": "Known issues",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        },
        {
          "key": "field4",
          "label": "Decision and rationale",
          "type": "text",
          "unit": "",
          "required": false,
          "choices": []
        }
      ]
    }
  ]
};
