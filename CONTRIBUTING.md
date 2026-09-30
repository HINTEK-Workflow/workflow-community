# Contributing

Thank you for helping improve Workflow.

## Before you start

- For anything larger than a small fix, open an issue first and describe the problem, so we can agree on the approach
  before you spend time on it.
- The user interface is in Swedish. Keep new texts short and in the same tone as the existing ones.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused on one thing, and write code that reads like the surrounding code.
3. Run the checks before you open the pull request:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```

4. Add or update unit tests (`tests/*.test.ts`) for the behaviour you change.
5. Describe what the change does and why in the pull request.

## Contributor License Agreement

Before a pull request can be merged, you sign the [Contributor License Agreement](CLA.md). The CLA bot asks you in the
pull request; you sign by posting the comment it shows. You sign once and it covers all your later contributions.

The CLA lets HINTEK Power Solutions AB include your contribution in both this AGPL-3.0 edition and HINTEK's commercial
edition. You keep the copyright to your contribution.

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
