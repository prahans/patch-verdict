import { Icon } from "@/components/mission/icon";

const verdicts = [
  {
    title: "VERIFIED",
    className: "is-verified",
    icon: "shield",
    description: "The reported bug was reproduced, the repository changed, verification integrity was preserved, the reproduction passed, and the full suite passed.",
    note: "Evidence satisfies every requirement.",
  },
  {
    title: "REVIEW_REQUIRED",
    className: "is-review",
    icon: "warning",
    description: "The patch passed verification, but touched sensitive test or verification infrastructure and should be reviewed by a human.",
    note: "Passing evidence. Human judgment needed.",
  },
  {
    title: "FAILED",
    className: "is-failed",
    icon: "x",
    description: "The candidate did not satisfy PatchVerdict's verification requirements.",
    note: "The evidence does not support approval.",
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
