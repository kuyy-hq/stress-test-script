import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "file:///C:/Program%20Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root = process.cwd();
const outputDir = path.join(root, "outputs", "01a1c131-d884-75d2-bd4a-8e9539e862be");
const outputPath = path.join(outputDir, "f1-stress-test-analysis-20261110.xlsx");
const previewDir = path.join(outputDir, "preview");

const runs = [
  { label: "Data 1", id: "20261110-001224", file: "results/20261110-001224-f1-load.json" },
  { label: "Data 2", id: "20261110-002313", file: "results/20261110-002313-f1-load.json" },
  { label: "Data 3 (saved)", id: "20261110-002847", file: "results/20261110-002847-f1-load.json" },
];

function metricValue(doc, name, key, fallback = null) {
  return doc?.metrics?.[name]?.[key] ?? fallback;
}

for (const run of runs) {
  run.doc = JSON.parse(await fs.readFile(path.join(root, run.file), "utf8"));
  const m = run.doc.metrics;
  run.values = {
    targetRps: 1000,
    requests: metricValue(run.doc, "http_reqs", "count", 0),
    avgRps: metricValue(run.doc, "http_reqs", "rate", 0),
    failedRequests: metricValue(run.doc, "http_req_failed{kind:web}", "passes", metricValue(run.doc, "http_req_failed", "passes", 0)),
    errorRate: metricValue(run.doc, "http_req_failed{kind:web}", "value", metricValue(run.doc, "http_req_failed", "value", 0)),
    dropped: metricValue(run.doc, "dropped_iterations", "count", 0),
    maxVus: metricValue(run.doc, "vus_max", "max", metricValue(run.doc, "vus_max", "value", 0)),
    avg: metricValue(run.doc, "http_req_duration{kind:web}", "avg", 0),
    median: metricValue(run.doc, "http_req_duration{kind:web}", "med", 0),
    p90: metricValue(run.doc, "http_req_duration{kind:web}", "p(90)", 0),
    p95: metricValue(run.doc, "http_req_duration{kind:web}", "p(95)", 0),
    p99: metricValue(run.doc, "http_req_duration{kind:web}", "p(99)", 0),
    max: metricValue(run.doc, "http_req_duration{kind:web}", "max", 0),
    ttfbP95: metricValue(run.doc, "http_req_waiting", "p(95)", 0),
    receivingP95: metricValue(run.doc, "http_req_receiving", "p(95)", 0),
    status5xx: metricValue(run.doc, "status_5xx", "count", 0),
    status403: metricValue(run.doc, "status_403", "count", 0),
  };
}

const wb = Workbook.create();
const summary = wb.worksheets.add("Summary");
const data = wb.worksheets.add("Run Data");
const oom = wb.worksheets.add("Frontend OOM");

const font = "Arial";
const navy = "#17324D";
const teal = "#167D8D";
const blue = "#4472C4";
const red = "#C00000";
const lightRed = "#FCE4E4";
const amber = "#F4B183";
const lightAmber = "#FFF2CC";
const lightBlue = "#DDEBF7";
const lightGray = "#F2F4F7";
const border = "#D4D9DF";
const white = "#FFFFFF";
const dark = "#1F2933";

function baseSheet(sheet, range) {
  sheet.showGridLines = false;
  sheet.getRange(range).format.font = { name: font, size: 10, color: dark };
  sheet.getRange(range).format.verticalAlignment = "center";
}

function title(sheet, text, subtitle, endCol) {
  sheet.getRange("A2").values = [[text]];
  sheet.getRange("A2").format.font = { name: font, size: 16, bold: true, color: navy };
  sheet.getRange(`A3:${endCol}3`).format.borders = { bottom: { style: "thin", color: teal } };
  sheet.getRange("A4").values = [[subtitle]];
  sheet.getRange(`A4:${endCol}4`).format.font = { name: font, size: 10, italic: true, color: "#5B6573" };
}

function sectionHeader(sheet, range, text) {
  const band = sheet.getRange(range);
  band.format = {
    fill: navy,
    font: { name: font, size: 10, bold: true, color: white },
    verticalAlignment: "center",
  };
  band.getCell(0, 0).values = [[text]];
}

// Run Data
baseSheet(data, "A1:W25");
title(data, "F1 stress-test source data", "Saved k6 summaries. Derived fields use formulas so calculations remain auditable.", "W");
const headers = [[
  "Run", "Run ID", "Target RPS", "Requests", "Average RPS", "Failed requests", "Successful requests",
  "Error rate", "Dropped iterations", "Planned iterations", "Delivery rate", "Max VUs", "Average (ms)",
  "Median (ms)", "p90 (ms)", "p95 (ms)", "p99 (ms)", "Maximum (ms)", "TTFB p95 (ms)",
  "Receiving p95 (ms)", "5xx", "403", "Result"
]];
data.getRange("A6:W6").values = headers;
data.getRange("A6:W6").format = {
  fill: navy,
  font: { name: font, size: 9, bold: true, color: white },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { insideVertical: { style: "thin", color: white }, bottom: { style: "medium", color: navy } },
};

runs.forEach((run, i) => {
  const r = 7 + i;
  const v = run.values;
  data.getRange(`A${r}:F${r}`).values = [[run.label, run.id, v.targetRps, v.requests, v.avgRps, v.failedRequests]];
  data.getRange(`H${r}:I${r}`).values = [[v.errorRate, v.dropped]];
  data.getRange(`L${r}:V${r}`).values = [[v.maxVus, v.avg, v.median, v.p90, v.p95, v.p99, v.max, v.ttfbP95, v.receivingP95, v.status5xx, v.status403]];
  data.getRange(`G${r}`).formulas = [[`=D${r}-F${r}`]];
  data.getRange(`J${r}`).formulas = [[`=D${r}+I${r}`]];
  data.getRange(`K${r}`).formulas = [[`=D${r}/J${r}`]];
  data.getRange(`W${r}`).formulas = [[`=IF(AND(H${r}<1%,P${r}<1200,Q${r}<2500,I${r}=0,U${r}=0,V${r}=0),"PASS","FAIL")`]];
});
data.getRange("A7:W9").format.borders = { bottom: { style: "thin", color: border } };
data.getRange("C7:G9").format.numberFormat = "#,##0.0";
data.getRange("D7:D9").format.numberFormat = "#,##0";
data.getRange("F7:G9").format.numberFormat = "#,##0";
data.getRange("H7:H9").format.numberFormat = "0.00%";
data.getRange("I7:J9").format.numberFormat = "#,##0";
data.getRange("K7:K9").format.numberFormat = "0.0%";
data.getRange("L7:V9").format.numberFormat = "#,##0.0";
data.getRange("U7:V9").format.numberFormat = "#,##0";
data.getRange("W7:W9").format = { fill: lightRed, font: { name: font, size: 10, bold: true, color: red }, horizontalAlignment: "center" };

sectionHeader(data, "A12:W12", "Unmatched terminal excerpt supplied as Data 3");
data.getRange("A13:H13").values = [["Metric", "Average (ms)", "Minimum (ms)", "Median (ms)", "Maximum (ms)", "p90 (ms)", "p95 (ms)", "p99 (ms)"]];
data.getRange("A13:H13").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center" };
data.getRange("A14:H15").values = [
  ["All web requests", 7990, 37.85, 3450, 60000, 30030, 30040, 30040],
  ["Expected responses", 4840, 55.94, 2520, 38470, 13340, 18800, 27060],
];
data.getRange("B14:H15").format.numberFormat = "#,##0.0";
data.getRange("A17").values = [["Limitation"]];
data.getRange("B17:W17").merge();
data.getRange("B17").values = [["This terminal excerpt does not match the saved 20261110-002847 JSON and does not include http_req_failed, request count, dropped iterations, or VUs. It is excluded from summary KPIs and charts."]];
data.getRange("A17").format.font = { name: font, size: 10, bold: true, color: red };
data.getRange("B17:W17").format = { fill: lightAmber, font: { name: font, size: 10, color: dark }, wrapText: true };
data.getRange("B17:W17").format.rowHeight = 36;
data.freezePanes.freezeRows(6);

const widths = {
  A: 18, B: 19, C: 12, D: 13, E: 14, F: 15, G: 17, H: 12, I: 18, J: 17, K: 13, L: 11,
  M: 15, N: 14, O: 12, P: 12, Q: 12, R: 15, S: 16, T: 20, U: 9, V: 9, W: 11,
};
for (const [col, width] of Object.entries(widths)) data.getRange(`${col}:${col}`).format.columnWidth = width;
data.getRange("A6:W6").format.rowHeight = 38;

// Summary
baseSheet(summary, "A1:P46");
summary.tabColor = navy;
title(summary, "F1 web stress-test analysis", "Target: https://test-war.kuyy.id | Scenario: f1 | Profile: load | Target rate: 1,000 RPS", "P");

const cards = [
  { label: "Latest error rate", formula: "='Run Data'!H9", format: "0.0%", col: "A", end: "C", fill: lightRed, color: red },
  { label: "Latest delivery rate", formula: "='Run Data'!K9", format: "0.0%", col: "E", end: "G", fill: lightAmber, color: "#9C5700" },
  { label: "Latest p95 latency", formula: "='Run Data'!P9", format: "#,##0 \"ms\"", col: "I", end: "K", fill: lightRed, color: red },
  { label: "Latest dropped iterations", formula: "='Run Data'!I9", format: "#,##0", col: "M", end: "O", fill: lightRed, color: red },
];
for (const card of cards) {
  summary.getRange(`${card.col}6:${card.end}6`).merge();
  summary.getRange(`${card.col}6`).values = [[card.label]];
  summary.getRange(`${card.col}7:${card.end}8`).merge();
  summary.getRange(`${card.col}7`).formulas = [[card.formula]];
  summary.getRange(`${card.col}6:${card.end}8`).format = {
    fill: card.fill,
    font: { name: font, size: 10, color: dark },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: border },
  };
  summary.getRange(`${card.col}6:${card.end}6`).format.font = { name: font, size: 10, bold: true, color: dark };
  summary.getRange(`${card.col}7:${card.end}8`).format.font = { name: font, size: 16, bold: true, color: card.color };
  summary.getRange(`${card.col}7`).format.numberFormat = card.format;
}

sectionHeader(summary, "A10:H10", "Run comparison");
summary.getRange("A11:H11").values = [["Run", "Error rate", "Delivery rate", "Average RPS", "Median (ms)", "p95 (ms)", "p99 (ms)", "Result"]];
summary.getRange("A11:H11").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center" };
for (let i = 0; i < 3; i++) {
  const sr = 12 + i;
  const dr = 7 + i;
  summary.getRange(`A${sr}:H${sr}`).formulas = [[
    `='Run Data'!A${dr}`, `='Run Data'!H${dr}`, `='Run Data'!K${dr}`, `='Run Data'!E${dr}`,
    `='Run Data'!N${dr}`, `='Run Data'!P${dr}`, `='Run Data'!Q${dr}`, `='Run Data'!W${dr}`,
  ]];
}
summary.getRange("B12:C14").format.numberFormat = "0.0%";
summary.getRange("D12:G14").format.numberFormat = "#,##0.0";
summary.getRange("A12:H14").format.borders = { bottom: { style: "thin", color: border } };
summary.getRange("H12:H14").format = { fill: lightRed, font: { name: font, size: 10, bold: true, color: red }, horizontalAlignment: "center" };

sectionHeader(summary, "A17:H17", "Threshold review");
summary.getRange("A18:D18").values = [["Metric", "Required", "Latest", "Assessment"]];
summary.getRange("A18:D18").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center" };
summary.getRange("A19:B24").values = [
  ["Error rate", 0.01], ["p95 latency (ms)", 1200], ["p99 latency (ms)", 2500],
  ["Dropped iterations", 0], ["5xx responses", 0], ["403 responses", 0],
];
summary.getRange("C19:C24").formulas = [["='Run Data'!H9"], ["='Run Data'!P9"], ["='Run Data'!Q9"], ["='Run Data'!I9"], ["='Run Data'!U9"], ["='Run Data'!V9"]];
summary.getRange("D19:D24").formulas = [
  ["=IF(C19<B19,\"PASS\",\"FAIL\")"], ["=IF(C20<B20,\"PASS\",\"FAIL\")"], ["=IF(C21<B21,\"PASS\",\"FAIL\")"],
  ["=IF(C22=B22,\"PASS\",\"FAIL\")"], ["=IF(C23=B23,\"PASS\",\"FAIL\")"], ["=IF(C24=B24,\"PASS\",\"FAIL\")"],
];
summary.getRange("B19:C19").format.numberFormat = "0.0%";
summary.getRange("B20:C24").format.numberFormat = "#,##0.0";
summary.getRange("D19:D24").format = { fill: lightRed, font: { name: font, size: 10, bold: true, color: red }, horizontalAlignment: "center" };

sectionHeader(summary, "A27:H27", "Findings and next actions");
summary.getRange("A28:B31").values = [
  ["Finding", "The latest saved run improved error rate to 18.8%, but still failed the 1% limit."],
  ["Capacity", "Max VUs reached 2,100 and 91,713 iterations were dropped. The planned arrival rate was not delivered."],
  ["Frontend", "Next.js crashed near a 784 MB V8 heap limit after prolonged GC pressure."],
  ["Next action", "Run lower-RPS steps while collecting status-by-path, active requests, pod CPU/RSS/heap, and heap snapshots."],
];
for (let r = 28; r <= 31; r++) summary.getRange(`B${r}:H${r}`).merge();
summary.getRange("A28:A31").format.font = { name: font, size: 10, bold: true, color: navy };
summary.getRange("B28:H31").format.wrapText = true;
summary.getRange("A28:H31").format.borders = { bottom: { style: "thin", color: border } };
summary.getRange("A28:H31").format.rowHeight = 38;

// Charts based on summary table.
const latencyChart = summary.charts.add("bar", [summary.getRange("A11:A14"), summary.getRange("E11:E14"), summary.getRange("F11:F14"), summary.getRange("G11:G14")]);
latencyChart.title = "Latency by run (ms)";
latencyChart.titleTextStyle.fontSize = 12;
latencyChart.titleTextStyle.typeface = font;
latencyChart.legend = { position: "top", textStyle: { typeface: font, fontSize: 9 } };
latencyChart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 9 } };
latencyChart.yAxis = { numberFormatCode: "#,##0", numberFormatSourceLinked: false, textStyle: { typeface: font, fontSize: 9 } };
latencyChart.setPosition("J10", "P25");

const rateChart = summary.charts.add("bar", [summary.getRange("A11:A14"), summary.getRange("B11:B14"), summary.getRange("C11:C14")]);
rateChart.title = "Error and delivery rates";
rateChart.titleTextStyle.fontSize = 12;
rateChart.titleTextStyle.typeface = font;
rateChart.legend = { position: "top", textStyle: { typeface: font, fontSize: 9 } };
rateChart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 9 } };
rateChart.yAxis = { numberFormatCode: "0%", numberFormatSourceLinked: false, textStyle: { typeface: font, fontSize: 9 } };
rateChart.setPosition("J27", "P42");

for (const col of ["A", "B", "C", "D", "E", "F", "G", "H"]) summary.getRange(`${col}:${col}`).format.columnWidth = col === "A" ? 22 : 16;
summary.getRange("I:I").format.columnWidth = 3;
for (const col of ["J", "K", "L", "M", "N", "O", "P"]) summary.getRange(`${col}:${col}`).format.columnWidth = 12;

// Frontend OOM
baseSheet(oom, "A1:J38");
oom.tabColor = teal;
title(oom, "Frontend memory failure", "Next.js 16.4.5 | Pod: kuyy-client-war-7dff887c78-d2vc2 | V8 fatal out-of-memory", "J");

sectionHeader(oom, "A6:F6", "GC evidence");
oom.getRange("A7:C7").values = [["Metric", "Value", "Interpretation"]];
oom.getRange("A7:C7").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center" };
oom.getRange("A8:B15").values = [
  ["Process uptime before fatal GC (ms)", 1498694],
  ["Heap before GC (MB)", 762.1],
  ["Heap after GC (MB)", 758.0],
  ["Heap capacity after GC (MB)", 783.6],
  ["GC pause (ms)", 2659.58],
  ["Average mutator utilization", 0.198],
  ["Current mutator utilization", 0.102],
  ["Memory reclaimed by final GC (MB)", null],
];
oom.getRange("B15").formulas = [["=B9-B10"]];
oom.getRange("C8:C15").values = [
  ["Approximately 24 minutes 59 seconds after process start"],
  ["Heap was already close to its limit"],
  ["Most objects remained reachable after full GC"],
  ["Observed V8 heap ceiling"],
  ["Application paused while GC attempted recovery"],
  ["Only about 19.8% of time remained for application work on average"],
  ["Only about 10.2% remained at the final sample"],
  ["Very little memory was recovered"],
];
oom.getRange("A16:B17").values = [["Heap utilization after GC", null], ["Final-GC reclaim rate", null]];
oom.getRange("B16").formulas = [["=B10/B11"]];
oom.getRange("B17").formulas = [["=B15/B9"]];
oom.getRange("B8:B12").format.numberFormat = "#,##0.0";
oom.getRange("B13:B14").format.numberFormat = "0.0%";
oom.getRange("B15").format.numberFormat = "0.0";
oom.getRange("B16:B17").format.numberFormat = "0.0%";
oom.getRange("A8:C17").format.borders = { bottom: { style: "thin", color: border } };

sectionHeader(oom, "A20:F20", "Cause assessment");
oom.getRange("A21:C24").values = [
  ["Priority", "Cause", "Evidence"],
  [1, "SSR concurrency overload", "High latency and thousands of concurrent VUs keep per-request render and response objects alive."],
  [2, "Retained cache or application objects", "Full GC reclaimed only 4.1 MB. A leak is possible if heap does not fall after traffic stops."],
  [3, "Heap limit too close to working set", "The process reached a V8 heap ceiling near 784 MB; native memory exists outside this heap."],
];
oom.getRange("A21:C21").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center" };
oom.getRange("A22:C24").format.borders = { bottom: { style: "thin", color: border } };
oom.getRange("B22:C24").format.wrapText = true;
oom.getRange("A22:C24").format.rowHeight = 42;

sectionHeader(oom, "A27:F27", "Recommended actions");
oom.getRange("A28:D34").values = [
  ["Order", "Action", "Purpose", "Validation"],
  [1, "Run stepped load at 50, 100, 150, and 200 RPS per pod", "Find the sustainable throughput before queueing accelerates", "No dropped iterations; stable p95 and heap"],
  [2, "Collect heapUsed, RSS, CPU, active requests, and event-loop lag", "Separate target saturation from generator limits", "Metrics aligned to the k6 run ID"],
  [3, "Capture heap snapshots near the limit", "Identify retained object types and reference paths", "Compare snapshots before load and near failure"],
  [4, "Review SSR fetches, global Maps/arrays, custom caches, and listeners", "Find request data retained across renders", "Heap returns toward baseline after traffic stops"],
  [5, "Cache or prerender public pages and use CDN caching", "Reduce SSR work per request", "Lower TTFB, heap growth, and CPU per request"],
  [6, "Scale pods and only then raise Node heap with container headroom", "Increase capacity without triggering container OOM", "Pod RSS stays below its memory limit"],
];
oom.getRange("A28:D28").format = { fill: teal, font: { name: font, size: 9, bold: true, color: white }, horizontalAlignment: "center", wrapText: true };
oom.getRange("A29:D34").format.wrapText = true;
oom.getRange("A29:D34").format.rowHeight = 42;
oom.getRange("A29:D34").format.borders = { bottom: { style: "thin", color: border } };

oom.getRange("A:A").format.columnWidth = 35;
oom.getRange("B:B").format.columnWidth = 24;
oom.getRange("C:C").format.columnWidth = 68;
oom.getRange("D:D").format.columnWidth = 45;
for (const col of ["E", "F", "G", "H", "I", "J"]) oom.getRange(`${col}:${col}`).format.columnWidth = 12;

// Recalculate and verify.
wb.recalculate();

const summaryCheck = await wb.inspect({ kind: "table", sheetId: "Summary", range: "A2:P31", include: "values,formulas", tableMaxRows: 35, tableMaxCols: 16, maxChars: 12000 });
const dataCheck = await wb.inspect({ kind: "table", sheetId: "Run Data", range: "A6:W17", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 23, maxChars: 12000 });
const oomCheck = await wb.inspect({ kind: "table", sheetId: "Frontend OOM", range: "A6:D33", include: "values,formulas", tableMaxRows: 35, tableMaxCols: 6, maxChars: 10000 });
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan", maxChars: 5000 });
console.log("SUMMARY_CHECK\n" + summaryCheck.ndjson);
console.log("DATA_CHECK\n" + dataCheck.ndjson);
console.log("OOM_CHECK\n" + oomCheck.ndjson);
console.log("ERROR_SCAN\n" + errors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of ["Summary", "Run Data", "Frontend OOM"]) {
  const preview = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName.replaceAll(" ", "-").toLowerCase()}.png`), new Uint8Array(await preview.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const blob = await SpreadsheetFile.exportXlsx(wb);
await blob.save(outputPath);
const savedWb = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const savedCheck = await savedWb.inspect({ kind: "sheet,drawing", maxChars: 8000 });
console.log("SAVED_FILE_CHECK\n" + savedCheck.ndjson);
const savedPreview = await savedWb.render({ sheetName: "Summary", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(path.join(previewDir, "summary-exported.png"), new Uint8Array(await savedPreview.arrayBuffer()));
console.log(`OUTPUT=${outputPath}`);
