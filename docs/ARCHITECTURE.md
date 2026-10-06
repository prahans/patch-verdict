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
| M4: Causal Freeze | Standalone schema, grounding validator, and tests in this change; runtime integration still pending |
| M5: Repair Planner | Pending |

The current `investigate.ts` still produces the older combined diagnosis and
repair fields. Adding the standalone M4 module does not yet enforce causal
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
