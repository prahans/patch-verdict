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
        "Replace the contents of one repository file with a candidate fixed version.",

      parameters: {
        type: "object",

        properties: {
          path: {
            type: "string",
          },

          content: {
            type: "string",
          },
        },

        required: ["path", "content"],

        additionalProperties: false,
      },
    },
  },
];
