# Working agreement

## Publishing

Publish to `main` by default. Finished work goes all the way to the live site — branch,
push, open the PR, then merge it to `main` — without stopping to ask for the merge.

If a change should stop short of `main`, the owner will say so. Absent that, treat
"done" as "merged and deployed".

Deploying is what makes the app real: `main` publishes to GitHub Pages via
`.github/workflows/pages.yml`, and the phone loads whatever is on Pages. A merged PR
that was never deployed is not finished.

## What still needs a human

Nothing about merging. Repository settings are the exception — Pages source, branch
protection and similar live in Settings and cannot be set from a workflow, so call
those out rather than working around them.
