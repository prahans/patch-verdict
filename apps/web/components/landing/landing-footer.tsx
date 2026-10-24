export function LandingFooter() {
  return (
    <>
      <section className="landing-final-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="eyebrow amber">EXPLORE RECORDED RESULTS.</p>
          <h2 id="final-cta-title">Evaluate AI repairs with recorded evidence.</h2>
          <p>Explore selected controlled missions, candidate patches, recorded checks, and saved verdicts.</p>
        </div>
        <a className="landing-button" href="/benchmarks">Explore Benchmarks <span aria-hidden="true">↗</span></a>
      </section>
      <footer className="landing-footer">
        <a href="#top" className="landing-footer-brand">PATCHVERDICT<span>.</span></a>
        <p>AI proposes. Tools execute. Evidence informs review.</p>
      </footer>
    </>
  );
}
