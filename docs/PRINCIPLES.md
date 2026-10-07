# PatchVerdict principles and working agreement

## Product principles

- Prioritize evidence, root cause, reliability, and real-world correctness.
- Freeze causal reasoning before choosing repair targets. Keep causal assessment
  separate from Repair Planning.
- Preserve the initial Hypothesis Board. Record post-experiment assessments
  separately instead of rewriting what the system believed before observation.
- Trust host-observed files, command results, experiments, and actual Git changes.
  Model-generated evidence references and patcher claims require validation.
- Keep experiments bounded and reversible. Run only the trusted reproduction,
  restore the original file exactly, and fail closed on restoration failure.
- Rank experiments by predicted discrimination among the original hypotheses.
  Predictions and information-gain scores are assumptions, not causal evidence.
  Use attempt budgets and early stopping; do not spend a fixed number of rounds.
- An INCONCLUSIVE experiment cannot alone support a hypothesis. A
  TEST_SETUP_CONTROL that removes a failure establishes symptom suppression,
  not test-infrastructure causal ownership by itself.
- Distinguish ROOT_CAUSE_FIX, WORKAROUND, and MITIGATION. A passing reproduction
  and suite are necessary checks, not sufficient proof of a correct root-cause
  repair. Protected-file and integrity checks still apply.
- Preserve uncertainty. Request more evidence when causal selection is not
  justified; do not manufacture certainty to unlock patching.
- Keep the proof chain inspectable: baseline, observations, hypotheses,
  experiments, causal decision, repair intent, authorization, actual diff,
  verification, and deterministic verdict.
- Preserve host evidence and rejected response diagnostics when causal
  finalization fails. Rejected proposals never become accepted causal decisions.
- Compare repair alternatives only after freezing causality. The repair planner
  cannot rewrite the diagnosis or verification commands. BLOCKED is valid when
  the evidence or executor cannot support the required repair.

## Development workflow

This records the user's requested working style from the Compare Projects chats
and the October 6, 2026 continuation:

1. Inspect the actual feature branch before stating milestone completion.
2. Make small, reviewable changes on a branch and commit them through the GitHub
   workflow. Open a PR against the active development branch for isolated work.
3. Explain what changed, why it matters, and what is still pending.
4. Provide exact local fetch/switch/pull commands, then `pnpm typecheck`, then the
   new focused tests, then the maintained reliability suite.
5. Report observed test counts. Label unexecuted checks honestly; do not reuse an
   old expected count as a new passing result.
6. Following the October 7 instruction, finish all six implementation milestones
   and pass the reliability gates before the next real benchmark. Successful live
   validation remains separate from implementation completion. A failed run calls
   for a bounded fix and revalidation.
7. For meaningful changes made locally by the user after verification, provide
   an exact `git add . && git commit -m "..." && git push` reminder. Changes
   already committed remotely should be pulled, not recommitted.

Use the user's numbering: M1 reconnaissance, M2 hypothesis board, M3 counterfactual
tool, M4 experiment planner/information gain, M5 causal decision gate, M6 separate
repair planner. Preserve phase boundaries and complete runtime/proof integration;
standalone schemas alone do not complete a milestone.
