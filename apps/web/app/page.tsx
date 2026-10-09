import type { Metadata } from "next";
import { connection } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { LandingHeader } from "@/components/landing/landing-header";
import { Hero } from "@/components/landing/hero";
import { MissionLauncher } from "@/components/landing/mission-launcher";
import { Workflow } from "@/components/landing/workflow";
import { VerdictCards } from "@/components/landing/verdict-cards";
import { EvidencePreview } from "@/components/landing/evidence-preview";
import { TrustSection } from "@/components/landing/trust-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { loadProofBundle } from "@/lib/load-proof-bundle";
import { resolveRepositoryRoot } from "@/lib/repository-root";

export const metadata: Metadata = {
  title: "PatchVerdict — Every patch earns its verdict.",
  description: "Reproduce the bug, investigate a bounded repair, and verify the evidence. Every AI patch earns a deterministic verdict backed by a saved proof bundle.",
};

// Only offer a real, readable mission on this installation. Never link a fixture
// or assume an ignored output directory is present in another checkout.
async function findProofExample(): Promise<string | null> {
  try {
    const root = await resolveRepositoryRoot();
    const entries = await readdir(path.join(root, "output"), { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory() && /^real-[A-Za-z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    let fallback: string | null = null;
    for (const missionId of candidates) {
      try {
        const bundle = await loadProofBundle(missionId);
        if (!bundle.details.source) continue;
        if (bundle.mission.verdict === "VERIFIED") return missionId;
        fallback ??= missionId;
      } catch {
        // An incomplete or unreadable bundle must not become a public example.
      }
    }
    return fallback;
  } catch {
    return null;
  }
}

export default async function Home() {
  await connection();
  const proofExampleId = await findProofExample();

  return (
    <div id="top" className="landing-page">
      <a className="skip-link" href="#verify">Skip to verification form</a>
      <LandingHeader />
      <main className="landing-shell">
        <div className="landing-intro">
          <Hero proofExampleId={proofExampleId} />
          <MissionLauncher />
        </div>
        <div className="landing-pipeline" aria-label="Verification process">
          {["REPRODUCE", "INVESTIGATE", "PATCH", "VERIFY", "VERDICT"].map((phase, index) => (
            <span key={phase}>{index > 0 && <span className="pipeline-arrow" aria-hidden="true">→</span>}{phase}</span>
          ))}
        </div>
        <Workflow />
        <VerdictCards />
        <EvidencePreview proofExampleId={proofExampleId} />
        <TrustSection />
        <LandingFooter />
      </main>
    </div>
  );
}
