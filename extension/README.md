# OpsPilot — Chromium Side Panel (MV3)

Manifest V3 side panel for **Chrome**, **Brave**, and **Edge**.

## Develop

From the repo root:

```bash
npm install
npm run dev
# or
npm run build
```

Then load unpacked:

| Browser | Load unpacked |
|---|---|
| Chrome | `chrome://extensions` → Developer mode → Load unpacked → `extension/dist` |
| Brave | `brave://extensions` → same |
| Edge | `edge://extensions` → same |

Click the OpsPilot toolbar action to open the side panel.

## Notes

- Uses the `chrome.*` API surface shared by Chromium browsers.
- Networking (ERPNext HTTP + Hermes WebSocket + `/api/fs`) runs in the side panel / native bridge.
- Artifacts open in normal browser tabs; downloads use `chrome.downloads` with Save As.
- Password-gated FS calls use `credentials: "include"` (Chrome strips manual `Cookie` headers).
