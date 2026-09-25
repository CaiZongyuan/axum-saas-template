# Engineering flow

Use ask-matt to choose the route; this project is a multi-session build.

## Planning and publication

1. Refine requirements with grill-with-docs, recording terminology and meaningful ADRs.
2. Synthesize the agreed behavior and public testing interfaces into a spec with to-spec. Existing architecture material is an input; avoid repeating the interview just to reformat it.
3. Use to-tickets to produce vertical, individually verifiable slices with only their real blockers.
4. Show the numbered breakdown, full acceptance criteria and test strategy. Obtain the user's approval of granularity/dependencies before publishing.
5. Publish the spec and approved implementation tickets to GitHub; create and verify native blocking edges. Leave source/parent issues unchanged thereafter.

The reviewed v1 spec and 28 implementation issues are published on GitHub. Their real issue URLs and dependency breakdown are indexed by docs/plans/template-v1.md; use GitHub for live status.

## Per implementation ticket

1. Start a fresh context with the ticket, current comments, blockers, glossary and relevant ADRs. Read the agreed tests in docs/testing/strategy.md.
2. Claim only an implementation ticket whose blockers are complete. Keep unrelated repository/user changes intact.
3. Run implement: one behavior test goes red, the minimal end-to-end change turns it green, then take the next behavior. Use tdd at the agreed public interfaces rather than private implementation details.
4. Run focused tests/type checks during development. Update the actual example, online tutorial, generated references and example ownership manifest with the feature.
5. Use focused HTTP/View tests and type checks during development. Run `just check` before delivery; it excludes browser E2E. Run E2E once when a new critical user journey is complete, for a browser-specific regression, or at milestone integration. Record the tested revision; avoid repeating the same browser suite locally, on every push and after merge.
6. Run code-review against a fixed point using Standards and Spec reviews, fix actionable findings, then commit. The review skill controls its own parallel review agents.
7. Commit and push each reviewed slice promptly. Open a PR linked to the ticket and include behavior, evidence and limitations. For the approved v1 build, the user has authorized autonomous Issue/PR management and merging after required checks pass; continue to the next unblocked ticket until v1 is complete.

Do not save tests, documentation or example removability for a final cleanup ticket. The release ticket checks that already-delivered chapters form a coherent learning path.

## Context and detours

Keep the current design/spec/ticket reasoning together through publication when feasible. Each implementation context is then independent because the ticket is self-contained.

Use a prototype only when a design question needs runnable evidence; return the result to the spec before implementation. Use diagnosing-bugs for a difficult regression, research for primary-source reading, and wizard only for a step the agent cannot perform itself.
