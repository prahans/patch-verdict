import { MissionHeader } from "@/components/mission/mission-header";
import { MissionLauncher } from "@/components/mission/mission-launcher";
import { Icon } from "@/components/mission/icon";

export default function Home() {
  return (
    <>
      <MissionHeader verdict={null} />

      <main id="mission" className="mission-shell launcher-shell">
        <div className="workspace-bar">
          <div className="flex items-center gap-3">
            <Icon name="terminal" />
            <span>Mission control</span>
            <span className="text-muted" aria-hidden="true">
              /
            </span>
            <span className="font-mono text-muted">new mission</span>
          </div>

          <span className="bundle-label">
            <span className="status-dot amber" />
            Backend connected
          </span>
        </div>

        <section className="launcher-hero">
          <p className="eyebrow amber">PATCH VERIFICATION</p>
          <h2>Every patch earns its verdict.</h2>
          <p>
            AI proposes the repair. PatchVerdict executes it in a sandbox,
            reruns the reported failure and full test suite, and records the
            evidence before producing a verdict.
          </p>
        </section>

        <MissionLauncher />

        <section className="launcher-flow" aria-label="PatchVerdict workflow">
          <div>
            <span>01</span>
            <strong>Reproduce</strong>
            <p>Confirm the reported failure before allowing any patch.</p>
          </div>
          <div>
            <span>02</span>
            <strong>Investigate</strong>
            <p>Use bounded repository tools to gather evidence.</p>
          </div>
          <div>
            <span>03</span>
            <strong>Patch</strong>
            <p>Apply one evidence-backed, authorized candidate change.</p>
          </div>
          <div>
            <span>04</span>
            <strong>Verify</strong>
            <p>Rerun the reproduction and full suite for the verdict.</p>
          </div>
        </section>

        <footer className="mission-footer">
          <p>
            <span className="footer-mark">PV</span> AI proposes. Tools execute.
            Tests verify. Humans approve.
          </p>
          <span>LOCAL HACKATHON MISSION RUNNER</span>
        </footer>
      </main>
    </>
  );
}
