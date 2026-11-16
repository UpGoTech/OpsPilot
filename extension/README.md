# OpsPilot version-02 — Chromium Side Panel (MV3)

Manifest V3 side panel for **Chrome**, **Brave**, and **Edge**. Same ERPNext → AI gateway flow as the desktop (`version-01`) client.

## Develop

From the repo root:

```bash
npm install
npm run extension:dev
```

For unpacked loads, build once:

```bash
npm run extension:build
```

Then in each browser:

| Browser | Load unpacked |
|---|---|
| Chrome | `chrome://extensions` → Developer mode → Load unpacked → `extension/dist` |
| Brave | `brave://extensions` → same |
| Edge | `edge://extensions` → same |

Click the OpsPilot toolbar action to open the side panel.

## Notes

- Uses the `chrome.*` API surface shared by Chromium browsers.
- Networking (ERPNext HTTP + Hermes WebSocket) runs in the side panel page so the socket stays alive while the panel is open.
- Nested desktop webviews become normal browser tabs; downloads use `chrome.downloads`.
