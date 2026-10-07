# PatchVerdict architecture

PatchVerdict investigates reproduced repository bugs, proposes bounded repairs,
and records the evidence behind a deterministic verdict. AI output is consumed
programmatically through structured contracts and sandbox tools. The product's
goal is a defensible repair and an inspectable proof bundle.

## Existing mission pipeline

The host prepares a repository at a known commit, detects its tooling, and runs
a trusted baseline reproduction. Investigation uses repository observations and
bounded tools, followed by causal-only finalization and a separate gated repair
plan. Patch authorization constrains edits; verification checks the
actual changes, reruns reproduction and the full suite, and produces a verdict.
The proof bundle preserves the investigation, commands, diff, and checks.

`VERIFIED`, `REVIEW_REQUIRED`, and `FAILED` are host decisions. Passing tests
alone does not override verification integrity or turn a mitigation into a
root-cause fix.

## v4 causal investigation design

The intended order is:

1. Deterministic reconnaissance supplies repository inventory and inspected files.
2. An initial, target-free Hypothesis Board records competing explanations.
3. An experiment planner compares evidence-grounded outcome predictions and the
   host selects an untried intervention with positive predicted information gain.
4. Bounded counterfactual experiments temporarily change one text fragment in
   an allowlisted runner configuration or shared setup file, run the trusted
   reproduction, restore the original text, and verify tracked-tree cleanliness.
5. Causal Freeze assesses every original hypothesis against observed evidence.
   Only a grounded `FROZEN` decision may enter Repair Planning.
6. The planner compares repair alternatives and returns `READY` or `BLOCKED`.
   A ready plan selects one authorized target/intent; authorization, patching,
   actual-diff validation, reproduction, full-suite checks, and verdict follow.

The pre-experiment board remains an immutable historical record. Assessments
belong to a separate post-evidence decision. Experiment interventions are never
candidate patches merely because they made a test pass.

## Milestone status

The user's six-milestone numbering is authoritative. Earlier notes incorrectly
labeled Causal Freeze M4 and the planner M5. Implementation status:

| Milestone | Status |
| --- | --- |
| M1: Reconnaissance | Implemented |
| M2: Hypothesis Board | Implemented |
| M3: Counterfactual Experiment Tool | Implemented, including intervention-role semantics |
| M4: Experiment Planner / information gain | Implemented: strict predictions, host ranking, duplicate prevention, attempt budgets, early stopping, and persisted planning/execution records |
| M5: Causal Decision Gate | Implemented: separate finalization, immutable causal fields, FROZEN planning gate, and failed-decision proof preservation |
| M6: Separate Repair Planner | Implemented: explicit repair alternatives, READY/BLOCKED decision, one selected target/intent, host verification commands, and proof records |

All six are implemented for the current bounded, single-file repair executor.
Model/sandbox boundaries are mocked in local runtime tests. Successful real
benchmark validation is still pending; implementation completion does not claim
that the live model identifies the correct cause or produces a successful repair.

`investigate.ts` now collects causal evidence and returns a separate freeze.
It no longer accepts a combined diagnosis and repair plan. `runMission()` stores
the decision and evidence before invoking the explicit planning gate. A grounded
`NEEDS_MORE_EVIDENCE` decision stops the mission before planning or patching and
remains available in the failed mission's proof bundle.

## Experiment planning and information gain

The collector exposes `plan_experiments`, not direct `run_counterfactual` access.
Each proposal contains up to three candidate interventions, a named causal
variable, and one evidence-cited predicted outcome for every original hypothesis.
Use `UNKNOWN` rather than inventing an outcome. The host checks hypothesis coverage,
evidence availability and experiment scope, complete inspection of the intervention
file, the reconnaissance allowlist, a unique exact-text match, and a real change.
The host enforces one file/fragment; free-text descriptions do not prove that an
intervention changes only one semantic causal variable.

`predictedInformationGain()` is an explicit ranking heuristic. It assumes equal
weights for the original hypotheses, deterministic predictions for
`FAILURE_REMOVED` / `FAILURE_PERSISTS`, and a 50/50 prediction for `UNKNOWN`.
For N predictions with r removal predictions and u unknown predictions, the score
is `H2((r + u/2) / N) - u/N` bits, where H2 is binary entropy. Both opposing concrete
outcomes are required; otherwise the score is zero. This makes a cleanup control
predicted to suppress the symptom under every hypothesis uninformative. Predictions
are model assumptions, not calibrated probabilities or observed causal facts.

Valid candidates rank by decreasing score; ties prefer runner configuration,
then smaller text interventions, then candidate id. The host assigns the experiment
id and derives its addressed hypotheses from concrete predictions. UNKNOWN
hypotheses do not silently gain access to that experiment's evidence later.
Renaming a candidate or its question cannot repeat an already attempted path/find/
replacement combination. The selected request alone reaches the reversible tool.

Collection ceilings are 8 model turns, 24 total tool calls, 2 targeted test attempts,
3 experiment-planning rounds, and 2 experiment attempts. Failed executions consume
their attempt budget. These are ceilings, not quotas: an explicit stop, no new
positive-gain candidate, repeated calls, or an exhausted budget can end collection
earlier. A restoration failure aborts before causal finalization. The same finalizer
handles normal completion and nonfatal budget/early-stop paths.

`experimentPlanning` preserves proposals, rankings/rejection reasons, selected
requests, execution status, stop reason, and budget usage. Only actual restored
experiment records count as causal observations. A high score cannot establish
causal support; an INCONCLUSIVE result does not resolve a prediction.

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
question. HIGH confidence is incompatible with an unknown cause, a competing
SUPPORTED hypothesis, or unresolved causal hypotheses/questions.

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
ungrounded response gets at most one no-tool contract repair. Both the initial
request and repair receive a host-derived citation index, including the allowed
experiment sources for each original hypothesis.

If the initial decision parsed, the repair response uses a separate strict schema:
`assessmentUpdates` containing only an existing hypothesis id, explanatory reason,
and complete replacement citation list. The host applies these updates to a clone
of the initial decision and revalidates it. Selection, claim, layer, confidence,
assessment ids/statuses, ordering, and unresolved questions remain host-owned.
Unknown or repeated ids and additional fields are rejected. The model does not
regenerate the full decision during citation repair. If the original response did
not parse into the decision contract, one full contract repair remains available.
Transport/protocol failures do not trigger evidence repair.

`assertCausalFreezeReadyForPlanning()` first revalidates grounding and then blocks
any non-FROZEN decision. It is separate from `assertCausalFreezeGrounding()` because
a grounded deferred decision is a legitimate result, not permission to plan.

Both normal completion and exhausted tool budgets now use this finalizer. The
collector's free-text final message is discarded; only host-recorded file contents,
test results, and restored experiments count as observations in causal assessment.
Planning predictions are supplied separately as historical assumptions. Failed tool calls
do not add trusted evidence. The host rejects tools outside the investigation
allowlist, and an experiment restoration failure aborts the investigation.
Completed experiments print their actual outcome, intervention role, addressed
hypotheses, command exit code, and restoration status in the terminal. Tool
completion by itself does not indicate that a failure was removed.

## Separate repair planner

`planRepair()` runs only after `assertCausalFreezeReadyForPlanning()` succeeds.
Its response schema contains a READY/BLOCKED decision, compared repair alternatives,
scope, evidence observations, relevant files, target comparisons, intents, and a
report. It contains no root-cause or confidence
fields. The host projects those fields from the accepted freeze into the existing
diagnosis format used by authorization and patching.

READY requires at least two distinct alternatives with objectives, tradeoffs,
reasons, and host-available evidence. A no-change alternative is legitimate when
another edit cannot be justified. Exactly one patch alternative is selected; its
path, repair kind, and objective must match the sole recommended target and intent.
All alternative paths must be completely inspected and cite their own file.
The host records the original reproduction and full-suite commands; the planner
cannot substitute verification commands. A repair requiring multiple files,
uninspected content, or unavailable evidence can return BLOCKED with explicit
blockers and no plan/selection. It stops without another model repair request.

Competing assessment statuses are preserved: WEAKENED is not relabeled REJECTED.
SUPPORTED and UNRESOLVED competitors block ROOT_CAUSE_FIX. HIGH confidence also
cannot coexist with competing support. The legacy failureMechanism field currently
reuses the frozen causalClaim; the planner cannot invent a new causal mechanism.

The planner retains provenance, causal-context, scope, target, repair-kind, and
intent validators. No tools are available during planning. One no-tool repair
may fix citations or explanations in a parsed plan, but may not change its target,
scope, evidence observations, repair objectives, selected alternative, tradeoffs,
or blockers. A failed plan does not erase
the already recorded causal decision.

`proof.json` now records causalFreeze, the causalEvidence snapshot, and any mission
error alongside the original board and experiments. Diagnosis is null when no
repair plan was accepted. Existing web report rendering can display the textual
causal report; dedicated causal proof UI is not part of this change.

The bundle also records `experimentPlanning`, `repairPlan` (including a legitimate
BLOCKED decision and host verification commands), and `repairPlanningFailure`
(rejected response text and errors). Collection failures after board creation retain
the observations and planning history gathered so far, including a failed restoration
record. A failed restoration is never promoted to restored experiment evidence.

When finalization fails, `CausalFreezeError` carries the same host snapshot used by
the model and validator. The investigator and mission runner preserve it in the
failed proof bundle, including board, file/test observations, restored experiments,
iteration count, and reconnaissance summary. `causalFreezeFailure.attempts` records
the initial and, if attempted, repair response text, expected response format, and
error. Request failures have null response text if no response arrived. Rejected
responses are diagnostics; `causalFreeze`, diagnosis, and patch remain null.

Runtime tests mock model/sandbox boundaries while exercising collection,
finalization, planning, mission gating, and proof serialization. The user's October
7, 2026 cleanup benchmark reproduced the bug but stopped before planning: EXP-2 was
cited for H3 despite being scoped to H1/H4, and the full-decision repair changed
protected causal semantics. The terminal output did not expose experiment outcomes
or rejected decisions, so those details remain unknown for that run. Citation-only
repair and failed-finalization proof preservation address these runtime gaps;
successful real-run validation is still pending.
