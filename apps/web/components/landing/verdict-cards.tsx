import { Icon } from "@/components/mission/icon";

const verdicts = [
  {
    title: "VERIFIED",
    className: "is-verified",
    icon: "shield",
    description: "The configured failure was reproduced, a patch was applied, and required tests passed. No recognized verification-integrity flags or violations were detected.",
    note: "Applies to the recorded checks.",
  },
  {
    title: "REVIEW_REQUIRED",
    className: "is-review",
    icon: "warning",
    description: "Required functional checks passed, but verification-related changes triggered integrity review flags that need human inspection.",
    note: "Passing checks. Human review needed.",
  },
  {
    title: "FAILED",
    className: "is-failed",
    icon: "x",
    description: "Completed verification did not satisfy the required functional or verification-integrity conditions.",
    note: "A failed execution may have no verdict.",
  },
] as const;

export function VerdictCards() {
  return (
    <section id="verdicts" className="landing-section" aria-labelledby="verdicts-title">
      <div className="landing-section-heading">
        <div><p className="eyebrow amber">02 / DETERMINISTIC VERDICTS</p><h2 id="verdicts-title">Passing tests alone are not always enough.</h2></div>
      </div>
      <div className="verdict-grid">
        {verdicts.map((verdict) => (
          <article className={`landing-verdict ${verdict.className}`} key={verdict.title}>
            <div className="landing-verdict-heading"><Icon name={verdict.icon} width="21" height="21" /><h3>{verdict.title}</h3></div>
            <p>{verdict.description}</p>
            <span className="landing-verdict-note">{verdict.note}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
