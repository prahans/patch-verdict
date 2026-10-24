import { Icon } from "@/components/mission/icon";

const principles = [
  ["terminal", "BOUNDED AI", "Investigation and repair attempts have fixed limits. Targeted investigation tests use Vitest."],
  ["branch", "DETERMINISTIC VERIFICATION", "Recorded test results, patch evidence, and integrity checks determine the verdict."],
  ["shield", "INTEGRITY REVIEW", "Checks flag recognized test and configuration changes; they cannot detect every way to weaken tests."],
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
