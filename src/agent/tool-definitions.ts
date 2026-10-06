export const investigationToolDefinitions = [
  {
    type: "function" as const,

    function: {
      name: "list_files",

      description:
        "List files in the repository. Use this to understand the project structure.",

      parameters: {
        type: "object",

        properties: {
          depth: {
            type: "number",
            minimum: 1,
            maximum: 5,
            description: "Maximum directory depth to inspect.",
          },
        },

        required: [],
        additionalProperties: false,
      },
    },
  },

  {
    type: "function" as const,

    function: {
      name: "read_file",

      description:
        "Read the contents of a repository file. Only use repository-relative paths returned by the repository tools.",

      parameters: {
        type: "object",

        properties: {
          path: {
            type: "string",
            description:
              "Repository-relative file path, for example src/divide.ts.",
          },
        },

        required: ["path"],
        additionalProperties: false,
      },
    },
  },

  {
    type: "function" as const,

    function: {
      name: "search_code",

      description: "Search repository source files for an exact text string.",

      parameters: {
        type: "object",

        properties: {
          query: {
            type: "string",
            description: "Text to search for in repository files.",
          },
        },

        required: ["query"],
        additionalProperties: false,
      },
    },
  },


  {
    type: "function" as const,

    function: {
      name: "run_counterfactual",

      description:
        "Run one reversible causal experiment against the trusted reproduction command. PatchVerdict temporarily changes exactly one allowlisted runner-config or shared test-setup text fragment, runs the trusted reproduction command, restores the original file exactly, and returns experiment evidence. Use this only to distinguish competing hypotheses, never as a candidate patch.",

      parameters: {
        type: "object",

        properties: {
          experimentId: {
            type: "string",
            pattern: "^EXP-[1-9]\\d*$",
            description: "Unique experiment id, for example EXP-1.",
          },

          hypothesisIds: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "string",
              pattern: "^H[1-5]$",
            },
            description:
              "Two or more hypothesis ids from the initial Hypothesis Board that this experiment is intended to distinguish.",
          },

          question: {
            type: "string",
            minLength: 10,
            description:
              "The causal discrimination question this temporary intervention is intended to answer.",
          },

          path: {
            type: "string",
            description:
              "Repository-relative runner-config or shared test-setup path from deterministic reconnaissance.",
          },

          find: {
            type: "string",
            minLength: 1,
            description:
              "Exact text fragment expected to occur exactly once in the allowlisted file.",
          },

          replace: {
            type: "string",
            description:
              "Temporary replacement text. The original file is restored automatically after the trusted reproduction command.",
          },
        },

        required: [
          "experimentId",
          "hypothesisIds",
          "question",
          "path",
          "find",
          "replace",
        ],

        additionalProperties: false,
      },
    },
  },

  {
    type: "function" as const,

    function: {
      name: "run_test",

      description:
        "Run a Vitest test by its test name and return actual execution evidence.",

      parameters: {
        type: "object",

        properties: {
          testName: {
            type: "string",
            minLength: 1,
            description:
              "Specific exact or partial test or suite name observed in repository evidence. Do not use generic selectors such as test, tests, spec, describe, it, all, *, or broad regex patterns.",
          },
        },

        required: ["testName"],
        additionalProperties: false,
      },
    },
  },
];

export const patchToolDefinitions = [
  {
    type: "function" as const,

    function: {
      name: "list_files",

      description:
        "List files in the repository. Use this to recover the correct repository-relative path instead of guessing.",

      parameters: {
        type: "object",

        properties: {
          depth: {
            type: "number",
            minimum: 1,
            maximum: 5,

            description: "Maximum directory depth to inspect.",
          },
        },

        required: [],

        additionalProperties: false,
      },
    },
  },

  {
    type: "function" as const,

    function: {
      name: "read_file",

      description: "Read a repository file before modifying it.",

      parameters: {
        type: "object",

        properties: {
          path: {
            type: "string",
          },
        },

        required: ["path"],

        additionalProperties: false,
      },
    },
  },

  {
    type: "function" as const,

    function: {
      name: "apply_patch",

      description:
        "Replace the contents of one repository file with a candidate fixed version authorized by a validated patch intent.",

      parameters: {
        type: "object",

        properties: {
          intentId: {
            type: "string",
            description:
              "Exact patch intent id from the validated investigation context, for example intent-1.",
          },

          path: {
            type: "string",
            description:
              "Repository-relative path authorized by the selected patch intent.",
          },

          content: {
            type: "string",
          },
        },

        required: ["intentId", "path", "content"],

        additionalProperties: false,
      },
    },
  },
];
