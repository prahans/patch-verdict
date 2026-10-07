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
6. Keep real benchmarks separate from standalone contract milestones. Once runtime
   gates pass, run the agreed benchmark and inspect its proof before advancing to
   more planner work. A failed run calls for a bounded fix and revalidation.
7. For meaningful changes made locally by the user after verification, provide
   an exact `git add . && git commit -m "..." && git push` reminder. Changes
   already committed remotely should be pulled, not recommitted.

For M4, complete and verify the standalone contract before wiring it into
`investigate.ts`. Runtime integration and Repair Planning are separate steps.
