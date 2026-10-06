# PatchVerdict architecture

PatchVerdict investigates reproduced repository bugs, proposes bounded repairs,
and records the evidence behind a deterministic verdict. AI output is consumed
programmatically through structured contracts and sandbox tools. The product's
goal is a defensible repair and an inspectable proof bundle.

## Existing mission pipeline

The host prepares a repository at a known commit, detects its tooling, and runs
a trusted baseline reproduction. Investigation uses repository observations and
bounded tools. Patch authorization constrains edits; verification checks the
actual changes, reruns reproduction and the full suite, and produces a verdict.
The proof bundle preserves the investigation, commands, diff, and checks.

`VERIFIED`, `REVIEW_REQUIRED`, and `FAILED` are host decisions. Passing tests
alone does not override verification integrity or turn a mitigation into a
root-cause fix.

## v4 causal investigation design

The intended order is:

1. Deterministic reconnaissance supplies repository inventory and inspected files.
2. An initial, target-free Hypothesis Board records competing explanations.
3. Bounded counterfactual experiments temporarily change one text fragment in
   an allowlisted runner configuration or shared setup file, run the trusted
   reproduction, restore the original text, and verify tracked-tree cleanliness.
4. Causal Freeze assesses every original hypothesis against observed evidence.
5. Only a grounded `FROZEN` decision may enter Repair Planning.
6. The planner proposes repair targets and intents; authorization, patching,
   actual-diff validation, reproduction, full-suite checks, and verdict follow.

The pre-experiment board remains an immutable historical record. Assessments
belong to a separate post-evidence decision. Experiment interventions are never
candidate patches merely because they made a test pass.

## Milestone status

Status for the continuation based on v4 commit `df5a332`:

| Milestone | Status |
| --- | --- |
| M1: Reconnaissance | Implemented |
| M2: Hypothesis Board | Implemented |
| M3: Counterfactual Experiment Tool | Implemented, including intervention-role semantics |
| M4: Causal Freeze | Schema, grounding validator, no-tool finalizer, explicit planning gate, and tests implemented; runtime integration still pending |
| M5: Repair Planner | Pending |

The current `investigate.ts` still produces the older combined diagnosis and
repair fields. The standalone M4 modules do not yet enforce causal
freeze in the live mission flow. The next integration must separate causal
assessment from repair planning and prevent `NEEDS_MORE_EVIDENCE` from reaching
the planner.

## Causal Freeze trust boundary

`parseCausalFreeze()` validates strict structure. `assertCausalFreezeGrounding()`
validates assessment coverage, evidence provenance, selection/layer consistency,
and known insufficient experimental grounds. The caller supplies the already
grounded original board, host-observed FILE/TEST references, and successful
counterfactual tool records. Never populate that context from model claims.

Every original hypothesis must appear exactly once. Experiment references must
resolve to uniquely identified, restored experiments addressing that hypothesis.
A frozen selection must be supported and retain its original cause layer.
Deferred decisions leave all selection fields null and name an unresolved
question. HIGH confidence is incompatible with an unknown cause or unresolved
causal hypotheses/questions.

These are provenance and consistency checks, not semantic proof. A cited file
or test must still substantiate the causal claim during reasoning/review; its
presence alone cannot establish causal ownership. Outcomes do not automatically
map to support or rejection because different hypotheses predict different
outcomes.

## No-tool causal finalization

`createCausalFreeze()` consumes the initial board, trusted baseline, successfully
read file contents, recorded test-tool results, and restored experiment records.
It snapshots those records before requesting a decision. The same snapshot
supplies the model context and the grounding allowlist; model output cannot add
trusted evidence, and later mutation of caller records cannot expand it.

No tools or repair-planning schema are exposed. Unexpected tool calls are rejected.
A valid `NEEDS_MORE_EVIDENCE` decision returns immediately. A malformed or
ungrounded response gets at most one no-tool contract repair. If the initial
decision parsed, the repair may change citations and explanatory reasons, but
must preserve selection, claim, layer, confidence, assessment ids/statuses, and
unresolved questions. Transport/protocol failures do not trigger evidence repair.

`assertCausalFreezeReadyForPlanning()` first revalidates grounding and then blocks
any non-FROZEN decision. It is separate from `assertCausalFreezeGrounding()` because
a grounded deferred decision is a legitimate result, not permission to plan.

Next integration must replace both existing investigator finalization paths
(normal completion and exhausted tool budget) with causal-only output. Only
after the explicit gate may a separate repair phase run. Preserve a deferred
decision and its evidence in the mission proof; do not silently discard it or
run patching after it. The no-tool finalizer and gate are not wired into those
paths yet. The real benchmark remains deferred.
