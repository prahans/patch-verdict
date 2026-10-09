const steps = [
  ["REPRODUCE", "Run the reported failure before modifying code."],
  ["INVESTIGATE", "AI explores repository evidence through bounded tools."],
  ["PATCH", "AI proposes the smallest evidence-supported change."],
  ["VERIFY", "PatchVerdict reruns the reproduction and full suite."],
  ["VERDICT", "Deterministic evidence produces VERIFIED, REVIEW_REQUIRED, or FAILED."],
] as const;

export function Workflow() {
  return (
    <section id="how-it-works" className="landing-section" aria-labelledby="workflow-title">
      <div className="landing-section-heading">
        <div><p className="eyebrow amber">01 / THE WORKFLOW</p><h2 id="workflow-title">From reported bug to recorded proof.</h2></div>
        <p>One mission. An inspectable chain of evidence.</p>
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
