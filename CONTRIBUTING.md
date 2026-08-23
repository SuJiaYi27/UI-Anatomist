# Contributing

Thank you for your interest in improving UI-Anatomist.

## Before you start

- Search existing Issues and Discussions.
- Open an Issue before starting a large change.
- Use the private process in `SECURITY.md` for vulnerabilities.
- Do not submit real website scans, private JSON, account data, credentials, internal paths, unreviewed screenshots, or material you cannot redistribute.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm ci`.
3. Make the smallest general change that solves the issue.
4. Add or update anonymized tests.
5. Run `npm run verify` and `npm run audit:public-tree`.
6. Open a pull request using the repository template.

Production behavior must not depend on a developer path, browser profile, private service, API key, specific website name, private selector, or unreleased internal fixture.

## Evidence and privacy

Prefer synthetic DOM and minimal anonymous JSON. If a real website reveals a bug, translate the behavior into a neutral fixture before submitting it.

## Dependencies and third-party material

Explain every new dependency and its license. Do not add copied code, fonts, icons, images, templates, or generated material without verifying source and redistribution terms.

## Contribution license

By submitting a contribution, you confirm that you have the right to submit it and agree that it is provided under Apache-2.0. If AI-assisted tools were used, you remain responsible for understanding, testing, and licensing the change.
