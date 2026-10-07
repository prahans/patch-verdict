export function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    if (typeof content === "object" && content !== null) {
      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    }

    return "";
  }

  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }

      if (
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
