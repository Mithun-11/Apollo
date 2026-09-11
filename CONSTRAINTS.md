# Project constraints

## Floor

- No secrets, real `.env` files, copyrighted audio, generated output, virtual environments, or dependency folders in Git.
- No skipped/deleted tests, empty exception handlers, unfinished stubs, or new lint/type suppressions without an approved reason.
- Do not weaken this file or CI to make a change pass.
- Runtime and dependency changes require a dedicated reviewed pull request and updated lockfiles.
- Applied database migrations are immutable; add a new numbered migration instead.

## Required checks

| Area | Commands | Policy |
|---|---|---|
| Backend | `ruff check app tests`, `mypy app`, `pytest` | Must pass |
| Frontend | `npm run lint`, `npm run typecheck`, `npm run build` | Must pass |
| Dependencies | `pip-audit --local`, `npm audit --audit-level=high` | No unreviewed high/critical finding |
| Platforms | GitHub CI on Windows and macOS | Must pass before merge |

The signal pipeline and integration checks are in place. Recognition accuracy and coverage still
need a larger recorded evaluation baseline before they can be ratcheted.
