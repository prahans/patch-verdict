export const agentToolDefinitions = [
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
            description: "Exact or partial test name to run.",
          },
        },

        required: ["testName"],
        additionalProperties: false,
      },
    },
  },
];
