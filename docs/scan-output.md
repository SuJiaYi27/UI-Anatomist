# Understanding Scan Output

The JSON passed from Chrome to Figma is a structured observation of rendered design evidence. It is not website source code, an original design file, a complete internal design system, or a grant of rights.

## Main sections

- `source`: origin-only source metadata, scan time, locale, and platform.
- `typography`, `colors`, `borderRadii`, `shadows`, and `spacing`: observed foundation evidence.
- `controls`: supported controls and states actually observed.
- `icons`: eligible, sanitized UI icon evidence.
- `composites`: evidence-backed relationships among controls and structures.
- `traversal` and `filtered`: bounded scan and filtering counts.
- `diagnostics`: anonymous rejection information used for validation; not a copy of page content.

The current exporter uses Schema 1.12. The importer parses Schema 1.0–1.12; compatibility claims for older output remain subject to the public anonymous test suite and final Release verification.

## Figma behavior

The importer validates the JSON and creates or updates editable variables, styles, components, component states, icons, and reference boards. Stable ownership rules support repeat imports and conflict reporting. Evidence that is incomplete, unsafe, or internally inconsistent may be filtered or reported instead of reconstructed.

## Sharing

Always inspect JSON before sharing it. Remove private or unauthorized material and confirm that you have the right to use and redistribute resulting assets. Public examples must use synthetic data or separately approved media; the repository does not distribute full real-website scan JSON.
