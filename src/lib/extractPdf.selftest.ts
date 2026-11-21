/**
 * Run: npx --yes tsx src/lib/extractPdf.selftest.ts
 * Guards the regression where PDF paths only appear in tool logs.
 */
import { extractPdfArtifacts } from "./extractPdf.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fromTool = extractPdfArtifacts(
  "One page, all 18 projects. HTML source is alongside it if you want to edit.",
  [
    `cd /opt/data && uv run --quiet --with pymupdf python - <<'PY'
p="/opt/data/FabriXcel_Active_Projects.pdf"
d=pymupdf.open(p)
PY`,
  ],
);

assert(
  fromTool.some((p) => p.path === "/opt/data/FabriXcel_Active_Projects.pdf"),
  `expected PDF from tool log, got ${JSON.stringify(fromTool)}`,
);

const fromProse = extractPdfArtifacts(
  "Saved to: `/opt/data/report.pdf` — ready for download.",
);
assert(
  fromProse.some((p) => p.path === "/opt/data/report.pdf"),
  `expected PDF from prose, got ${JSON.stringify(fromProse)}`,
);

const bare = extractPdfArtifacts("", ["wrote Active_Projects.pdf"]);
assert(
  bare.some((p) => p.filename === "Active_Projects.pdf"),
  `expected bare PDF resolve, got ${JSON.stringify(bare)}`,
);

console.log("extractPdf.selftest: ok");
