const steps = [
  ["REPRODUCE", "Check the configured failure before modifying code."],
  ["INVESTIGATE", "AI explores repository evidence through bounded tools."],
  ["PATCH", "AI attempts a candidate repair within fixed limits."],
  ["VERIFY", "Rerun the reproduction and repository test script."],
  ["VERDICT", "Completed verification yields VERIFIED, REVIEW_REQUIRED, or FAILED."],
] as const;

export function Workflow() {
  return (
    <section id="how-it-works" className="landing-section" aria-labelledby="workflow-title">
      <div className="landing-section-heading">
        <div><p className="eyebrow amber">01 / THE WORKFLOW</p><h2 id="workflow-title">From reported bug to recorded evidence.</h2></div>
        <p>A mission can stop before a patch or verdict is produced.</p>
      </div>
      <ol className="workflow">
        {steps.map(([title, description], index) => (
          <li key={title}>
            <span className="workflow-number">0{index + 1}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
