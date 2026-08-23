# Development

## Structure

```text
src/chrome/   Chrome extension source
src/figma/    Figma plugin source
src/shared/   Shared Schema and stable identity helpers
scripts/      Reproducible build and public-tree checks
tests/        Anonymous automated tests and fixtures
```

## Verified environment

The private candidate was verified with Node.js 24.19.0 and npm 11.16.0. The current `.nvmrc` and `packageManager` values are provisional reproducibility pins for local review, not a supported-version promise. The final public staging environment and tested compatibility will be recorded before publication.

## Install and verify

```bash
npm ci
npm run audit:public-tree
npm run verify
```

## Build outputs

```text
dist/chrome/
dist/figma/
dist/validation/schema.js
```

Build outputs are generated locally and are not committed to the source repository. Matching Chrome + Figma binaries are distributed together through GitHub Releases.

## Safety constraints

Production logic must not depend on developer paths, browser profiles, credentials, private services, real-site fixtures, or website-specific rules. Public tests use synthetic or authorized anonymous data.
