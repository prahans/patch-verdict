export function LandingFooter() {
  return (
    <>
      <section className="landing-final-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="eyebrow amber">THE NEXT PATCH NEEDS PROOF.</p>
          <h2 id="final-cta-title">Make AI-generated patches prove themselves.</h2>
          <p>Give PatchVerdict a repository, a reported bug, and a trusted reproduction command.</p>
        </div>
        <a className="landing-button" href="#verify">Verify a patch <span aria-hidden="true">↗</span></a>
      </section>
      <footer className="landing-footer">
        <a href="#top" className="landing-footer-brand">PATCHVERDICT<span>.</span></a>
        <p>AI proposes. Tools execute. Tests verify. Humans approve.</p>
      </footer>
    </>
  );
}
