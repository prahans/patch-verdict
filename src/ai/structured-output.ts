export function jsonSchemaResponseFormat(
  name: string,
  schema: Record<string, unknown>,
) {
  return {
    type: "json_schema" as const,
    jsonSchema: {
      name,
      strict: true,
      schema,
    },
  };
}
