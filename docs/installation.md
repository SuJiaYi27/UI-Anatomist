# Installation

UI-Anatomist Public Beta is distributed as one versioned package containing both the Chrome extension and the Figma plugin. Use both folders from the same Release.

## Requirements

- A current desktop version of Google Chrome.
- Figma Desktop.
- Permission to analyze the target website.
- No external AI service or API key.

## Tested environment for v0.1.0-beta.1

The combined Chrome + Figma package was accepted on:

- macOS 26.3.2 (Build 25D2150)
- Google Chrome 151.0.7922.171
- Figma Desktop 126.2.10 (Figma+EX)

The source verification environment used Node.js 24.19.0 and npm 11.16.0. These versions record the environment used for this Release; they are not minimum compatibility guarantees.

## Download

1. Open the latest GitHub Release.
2. Download `ui-anatomist-v0.1.0-beta.1.zip` and `SHA256SUMS.txt`.
3. Verify the archive checksum.
4. Extract the archive to a stable local folder.

The archive contains `chrome/`, `figma/`, `INSTALLATION.txt`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.

## Install the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the extracted `chrome/` folder.
5. Pin the extension if you want quick access.

The extension requests access to the current website only when you start a scan and approve the browser prompt.

## Install the Figma plugin

1. Open a Figma Design file in Figma Desktop.
2. Open **Plugins → Development → Import plugin from manifest**.
3. Select `figma/manifest.json` from the extracted package.
4. Run `UI-Anatomist` from the Development section.

## Run your first scan and import

1. Open a website you own or are authorized to analyze.
2. Save, send, or clear any unfinished text before scanning.
3. Open the Chrome extension and start the scan.
4. Review the permission request for the current website.
5. Wait for the scan to finish, then copy or download the JSON.
6. Run the matching Figma importer.
7. Paste the JSON and select **Import JSON**.
8. Review the created variables, styles, components, icons, and reference boards.

## Updating

Download the new combined Release and replace both installations with the matching version. Do not mix folders from different Releases.

## Troubleshooting

- If Chrome cannot load the extension, select the extracted `chrome/` folder rather than the ZIP.
- If Figma cannot find the manifest, use Figma Desktop and select `figma/manifest.json`.
- If the scan will not start, use an `http` or `https` page, clear unfinished input, and review the permission prompt.
- If the scan is incomplete, review the [known limitations](../README.md#known-limitations).
- If a font is missing, install or enable it and import again. The plugin does not silently substitute an unrelated font.
- If JSON is rejected, confirm that it came from the matching Release and was not manually damaged.
- If a repeat import looks wrong, preserve the version and a sanitized reproduction. Do not post sensitive JSON publicly.

## Uninstall

Remove the unpacked extension from `chrome://extensions` and the development plugin from Figma. Assets already created in a Figma file are not deleted automatically.

## Safety reminder

Review JSON before sharing it. Never post credentials, personal information, private URLs, account data, or sensitive screenshots in a public Issue.
