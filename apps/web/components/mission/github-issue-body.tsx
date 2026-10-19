type IssueBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string };

function parseIssueBody(body: string): IssueBlock[] {
  const blocks: IssueBlock[] = [];
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  const flushCode = () => {
    const text = code.join("\n").trim();
    if (text) blocks.push({ type: "code", text });
    code = [];
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) flushCode();
      else flushParagraph();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    const heading = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushCode();
  return blocks;
}

export function GitHubIssueBody({ body }: { body: string }) {
  const blocks = parseIssueBody(body);
  if (!blocks.length) return null;

  return (
    <div className="issue-body" aria-label="GitHub issue details">
      {blocks.map((block, index) =>
        block.type === "heading" ? (
          <p className="issue-body-heading" key={`${block.type}-${index}`}>
            {block.text}
          </p>
        ) : block.type === "code" ? (
          <pre className="issue-body-code" key={`${block.type}-${index}`}>
            <code>{block.text}</code>
          </pre>
        ) : (
          <p className="issue-body-paragraph" key={`${block.type}-${index}`}>
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

