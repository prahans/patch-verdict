import Link from "next/link";
import { Icon } from "@/components/mission/icon";

export function LandingHeader() {
  return (
    <header className="site-header landing-header">
      <div className="header-inner">
        <div className="brand-group">
          <Link href="/" className="brand" aria-label="PatchVerdict home">
            <span className="brand-symbol"><Icon name="shield" width="25" height="25" /></span>
            <span>PATCH<span className="brand-secondary">VERDICT</span><span className="brand-period">.</span></span>
          </Link>
          <span className="brand-tagline">Every patch earns its verdict.</span>
        </div>
        <div className="landing-nav-group">
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#verdicts">Verdicts</a>
            <a href="#evidence">Evidence</a>
          </nav>
          <a className="landing-button landing-button-small" href="#verify">Verify a patch <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </header>
  );
}
