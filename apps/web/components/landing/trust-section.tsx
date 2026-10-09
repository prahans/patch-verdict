import { Icon } from "@/components/mission/icon";

const principles = [
  ["terminal", "BOUNDED AI", "The agent can act only through declared repository tools."],
  ["branch", "DETERMINISTIC VERIFICATION", "Tests and Git evidence decide the verdict — not the AI."],
  ["shield", "HUMAN-AWARE SAFETY", "Sensitive verification changes can produce REVIEW_REQUIRED instead of blind approval."],
] as const;

export function TrustSection() {
  return (
    <section className="landing-section trust-section" aria-labelledby="trust-title">
      <div className="landing-section-heading">
        <div><p className="eyebrow amber">04 / BUILT FOR SCRUTINY</p><h2 id="trust-title">AI proposes. Evidence decides.</h2></div>
      </div>
      <div className="trust-grid">
        {principles.map(([icon, title, description]) => (
          <article className="trust-card" key={title}>
            <Icon name={icon} width="21" height="21" /><h3>{title}</h3><p>{description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
