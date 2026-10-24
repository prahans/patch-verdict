export function LandingFooter() {
  return (
    <>
      <section className="landing-final-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="eyebrow amber">PUT THE NEXT REPAIR TO THE TEST.</p>
          <h2 id="final-cta-title">Evaluate AI repairs with recorded evidence.</h2>
          <p>Start with a supported repository, a bug report, and a reproduction command you can inspect.</p>
        </div>
        <a className="landing-button" href="#verify">Start verification <span aria-hidden="true">↗</span></a>
      </section>
      <footer className="landing-footer">
        <a href="#top" className="landing-footer-brand">PATCHVERDICT<span>.</span></a>
        <p>AI proposes. Tools execute. Evidence informs review.</p>
      </footer>
    </>
  );
}
