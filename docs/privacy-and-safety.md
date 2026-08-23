# Privacy & Safety

## Data flow

1. The user starts a scan in Chrome and approves access to the current website origin.
2. The extension inspects bounded, rendered design evidence and selected safe interface states.
3. It generates JSON and stores it in Chrome's in-memory session storage.
4. The user copies or downloads the JSON and pastes it into the Figma plugin.
5. The Figma plugin validates the JSON and creates or updates assets in the current Figma file.

There is no project-operated backend between Chrome and Figma.

## Chrome permissions

- `activeTab` and optional website access work with the active website after an explicit user action.
- `scripting` runs the scanner and progress overlay in approved pages.
- `tabs` inspects, navigates, and restores the active tab during a bounded scan.
- `storage` keeps status and JSON in session memory.
- `clipboardWrite` copies JSON after the user selects the copy action.

Broad optional host patterns allow the extension to ask for the current website origin at runtime. They do not grant silent access to every website at installation time.

## What the scanner may inspect

- Computed typography, color, spacing, radius, shadow, geometry, and layout evidence.
- Supported controls and states visible or safely revealed during the scan.
- Eligible UI icons and evidence-backed composite structures.
- Page-referenced font files or same-origin SVG sprite resources needed to interpret eligible rendered evidence.
- Short visible labels or placeholders that pass safety filters.
- Metadata used locally to classify risk, restore state, or reject private content.
- Whether a visible input or editor contains unfinished content; only the non-empty condition is used to stop the scan.

## What is not intended for export

- Input, textarea, or contenteditable values.
- Account, profile, conversation, document, or project content.
- Long-form user-generated content.
- Cookies, passwords, API keys, access tokens, or browser credentials.
- Raster images, logos, avatars, brand assets, or unknown graphics.
- Native files or file-picker contents.

Some short interface labels may still appear after filtering. Always review exported files before sharing them.

## Website actions

The scanner blocks destructive, transactional, or account-changing actions such as deleting, submitting, purchasing, installing, authorizing, inviting, publishing, or selecting local files. It explores only bounded same-origin navigation and reversible interface states that pass the safety policy.

No automated system can cover every website implementation. Stop the scan if the website behaves unexpectedly.

## Network behavior

- The project does not call OpenAI, Codex, or a developer-operated API.
- It does not include telemetry or analytics.
- The Chrome scanner may fetch cross-origin page-linked stylesheets with `credentials: "omit"` to inspect otherwise inaccessible hover rules.
- It may re-read a page-referenced font or same-origin SVG sprite with `credentials: "same-origin"`. For a same-origin URL, the browser may attach the current website session in the same way as an ordinary page request. The response is processed locally and is not forwarded to a project backend.
- The Figma plugin declares `allowedDomains: ["none"]`.

## Storage and sharing

Chrome stores scan status and JSON in `chrome.storage.session`, not synchronized storage. Copying, downloading, uploading, or sharing JSON is controlled by the user. Inspect the source origin and short labels, remove anything private or unauthorized, and confirm redistribution rights before sharing.

## Legal and authorization boundary

Use the project only on websites, interfaces, and materials you own or are authorized to analyze. Technical visibility does not grant copyright, trademark, contractual, privacy, or redistribution rights. The project is not affiliated with or endorsed by websites used for compatibility testing.

## Public Beta boundary

Coverage is still evolving. Dynamic pages, custom controls, cross-origin styles, complex nested structures, and unobserved states may be incomplete. See the [known limitations](../README.md#known-limitations).
