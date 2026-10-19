// Export My Schools as an Excel workbook (.xlsx), CSV, or Word document (.docx), built in the browser.
// .xlsx and .docx files are zip archives of XML parts; zip() writes them uncompressed, which every
// reader accepts and keeps this file free of libraries. Exposes window.Exporter.
(() => {
  const { t, lang, useCny, fxRate, residency, tuitionOf, costTotal, COST_YEAR, YEARS, WORLD_EDITIONS, worldRank,
    climateGroup, climateValues, CLIMATE_UNITS, STATE_NAMES, CONTROL_LABEL, byId, library } = window.App;

  // ---- zip (method 0 = stored) ----
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function zip(files, mime) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      // Shared fields of the local header (from "version needed") and the central directory entry.
      const common = (v) => {
        v.setUint16(0, 20, true); v.setUint16(2, 0x0800, true); v.setUint16(4, 0, true); // v2.0, UTF-8 names, stored
        v.setUint16(6, time, true); v.setUint16(8, date, true); v.setUint32(10, crc, true);
        v.setUint32(14, data.length, true); v.setUint32(18, data.length, true); v.setUint16(22, name.length, true);
      };
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      common(new DataView(local.buffer, 4));
      parts.push(local, name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      common(new DataView(cd.buffer, 6));
      cd.setUint32(42, offset, true);
      central.push(cd, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: mime });
  }

  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  // ---- the data: one row per school, in board order ----
  const year = YEARS[0];
  const basis = () => t(residency.get() === "in" ? "cost.in" : "cost.out");
  function schools() {
    const order = Object.fromEntries(library.STATUSES.map((s, i) => [s.id, i]));
    return library.items()
      .map((x, i) => ({ ...x, i, c: byId.get(x.id) }))
      .sort((a, b) => order[a.status] - order[b.status] || a.i - b.i);
  }
  // Columns shared by the spreadsheet formats. Values are numbers where the column is numeric.
  function columns() {
    const U = CLIMATE_UNITS;
    const cols = [
      [t("lib.th.status"), (x) => library.STATUS_LABEL[x.status]],
      [t("rk.th.school"), (x) => x.c.name],
      [t("rk.th.city"), (x) => x.c.city],
      [t("rk.state"), (x) => STATE_NAMES[x.c.state] || x.c.state],
      [t("rk.type"), (x) => CONTROL_LABEL[x.c.control] || x.c.control],
      [t("exp.col.overall", { year }), (x) => x.c.ranks[year] ?? null],
      [t("subj.cs"), (x) => x.c.cs?.rank ?? null],
      [t("subj.csr"), (x) => x.c.csr?.rank ?? null],
      [`QS ${WORLD_EDITIONS.qs[0]}`, (x) => worldRank(x.c, "qs")],
      [`THE ${WORLD_EDITIONS.the[0]}`, (x) => worldRank(x.c, "the")],
      [t("exp.col.tuition", { basis: basis() }), (x) => tuitionOf(x.c), "money"],
      [t("exp.col.living"), (x) => x.c.cost?.living ?? null, "money"],
      [t("exp.col.books"), (x) => x.c.cost?.books ?? null, "money"],
      [t("exp.col.total"), (x) => costTotal(x.c), "money"],
    ];
    if (useCny) cols.push([t("exp.col.totalCny", { rate: fxRate.get() }),
      (x) => (costTotal(x.c) == null ? null : Math.round(costTotal(x.c) * fxRate.get())), "money"]);
    return cols.concat([
      [t("clim.type"), (x) => (climateGroup(x.c) ? t(`clim.g.${climateGroup(x.c)}`) : null)],
      ["Köppen", (x) => x.c.climate?.koppen ?? null],
      [t("exp.col.winter", { u: U.temp }), (x) => climateValues(x.c)?.winter ?? null],
      [t("exp.col.summer", { u: U.temp }), (x) => climateValues(x.c)?.summer ?? null],
      [t("exp.col.prcp", { u: U.rain }), (x) => climateValues(x.c)?.prcp ?? null],
      [t("exp.col.snow", { u: U.snow }), (x) => climateValues(x.c)?.snow ?? null],
      [t("exp.col.url"), (x) => x.c.url || null],
    ]);
  }

  // ---- CSV (UTF-8 with BOM so Excel reads Chinese correctly) ----
  function csv() {
    const cols = columns();
    const cell = (v) => (v == null ? "" : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [cols.map(([h]) => cell(h)).join(","),
      ...schools().map((x) => cols.map(([, f]) => cell(f(x))).join(","))];
    return new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  }

  // ---- Excel ----
  function xlsx() {
    const cols = columns(), rows = schools();
    const ref = (ci, ri) => {
      let s = "", n = ci + 1;
      while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
      return s + (ri + 1);
    };
    // Styles: 0 normal, 1 bold header, 2 "#,##0" for money.
    const cellXml = (v, ci, ri, style) => {
      if (v == null || v === "") return "";
      const s = style ? ` s="${style}"` : "";
      return typeof v === "number"
        ? `<c r="${ref(ci, ri)}"${s}><v>${v}</v></c>`
        : `<c r="${ref(ci, ri)}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    };
    const widths = cols.map(([h, f]) => Math.min(48, Math.max(8, String(h).length * (lang === "zh" ? 1.8 : 1.1),
      ...rows.map((x) => String(f(x) ?? "").length * (lang === "zh" ? 1.6 : 1.1))) + 2));
    const last = ref(cols.length - 1, rows.length);
    const sheet = HEAD + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join("")}</cols>
<sheetData>
<row r="1">${cols.map(([h], ci) => cellXml(h, ci, 0, 1)).join("")}</row>
${rows.map((x, ri) => `<row r="${ri + 2}">${cols.map(([, f, kind], ci) => cellXml(f(x), ci, ri + 1, kind === "money" ? 2 : 0)).join("")}</row>`).join("\n")}
</sheetData>
<autoFilter ref="A1:${last}"/>
</worksheet>`;
    const styles = HEAD + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const sheetName = t("nav.library").replace(/[[\]:*?/\\]/g, "").slice(0, 31);
    return zip([
      { name: "[Content_Types].xml", data: HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", data: HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: HEAD + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheetName)}'!$A$1:$${last.replace(/\d+$/, "")}$${rows.length + 1}</definedName></definedNames></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/worksheets/sheet1.xml", data: sheet },
      { name: "xl/styles.xml", data: styles },
    ], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  // ---- Word ----
  function docx() {
    const rows = schools();
    const links = []; // external hyperlink targets -> rId (rId1 is the styles part)
    const run = (text, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
    const para = (content, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${content}</w:p>`;
    const link = (url) => {
      links.push(url);
      return `<w:hyperlink r:id="rId${links.length + 1}">${run(url, '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`;
    };
    const colon = lang === "zh" ? "：" : ": ";
    const label = (k) => run(t(k) + colon, "<w:b/>");
    const money = (n) => (n == null ? "—" : useCny ? `¥${Math.round(n * fxRate.get()).toLocaleString("en-US")}` : `$${n.toLocaleString("en-US")}`);
    const rank = (r) => (r == null ? "—" : `#${r}`);

    const cell = (text, opts = {}) => `<w:tc><w:tcPr>${opts.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E6EDF8"/>' : ""}</w:tcPr>
      <w:p><w:pPr><w:spacing w:after="0"/>${opts.right ? '<w:jc w:val="right"/>' : ""}</w:pPr>${run(text, opts.bold ? "<w:b/>" : "")}</w:p></w:tc>`;
    const head = [t("rk.th.school"), t("lib.th.status"), t("exp.col.overall", { year }), t("subj.cs"), t("subj.csr"),
      `QS ${WORLD_EDITIONS.qs[0]}`, `THE ${WORLD_EDITIONS.the[0]}`, t("cost.th")];
    const overview = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h, i) => cell(h, { bold: true, shade: true, right: i > 1 })).join("")}</w:tr>
      ${rows.map((x) => `<w:tr>${[x.c.name, library.STATUS_LABEL[x.status], rank(x.c.ranks[year]), rank(x.c.cs?.rank),
        rank(x.c.csr?.rank), rank(worldRank(x.c, "qs")), rank(worldRank(x.c, "the")), money(costTotal(x.c))]
        .map((v, i) => cell(v, { right: i > 1 })).join("")}</w:tr>`).join("")}
    </w:tbl>`;

    const U = CLIMATE_UNITS;
    const school = (x) => {
      const c = x.c, cv = climateValues(c), g = climateGroup(c);
      const parts = [
        para(run(c.name), "Heading2"),
        para(label("exp.loc") + run(`${c.city}, ${STATE_NAMES[c.state] || c.state} · ${CONTROL_LABEL[c.control] || c.control}${c.metro ? ` · ${c.metro}` : ""}`)),
        para(label("exp.ranks") + run([
          `${t("exp.col.overall", { year })} ${rank(c.ranks[year])}`, `${t("subj.cs")} ${rank(c.cs?.rank)}`,
          `${t("subj.csr")} ${rank(c.csr?.rank)}`, `QS ${WORLD_EDITIONS.qs[0]} ${rank(worldRank(c, "qs"))}`,
          `THE ${WORLD_EDITIONS.the[0]} ${rank(worldRank(c, "the"))}`].join(" · "))),
      ];
      if (c.cost) parts.push(para(run(t("exp.cost", { year: COST_YEAR, basis: basis() }) + colon, "<w:b/>") + run(t("exp.costLine", {
        tuition: money(tuitionOf(c)), living: money(c.cost.living), books: money(c.cost.books), total: money(costTotal(c)) }))));
      if (cv) parts.push(para(label("clim.title") + run([
        `${g ? t(`clim.g.${g}`) : ""}${lang === "zh" ? "（柯本" : " (Köppen"} ${c.climate.koppen}${lang === "zh" ? "）" : ")"}`,
        `${t("clim.winterStat")} ${cv.winter}${U.temp}`, `${t("clim.summerStat")} ${cv.summer}${U.temp}`,
        `${t("clim.rainStatNoDays")} ${cv.prcp} ${U.rain}`, cv.snow == null ? "" : `${t("clim.snowStat")} ${cv.snow} ${U.snow}`,
      ].filter(Boolean).join(" · "))));
      if (c.url) parts.push(para(label("exp.col.url") + link(c.url)));
      return parts.join("");
    };

    const counts = library.STATUSES.map((s) => [s, rows.filter((x) => x.status === s.id).length]).filter(([, n]) => n);
    const today = new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", day: "numeric" });
    const body = [
      para(run(t("exp.docTitle")), "Title"),
      para(run(t("exp.docMeta", { date: today, n: rows.length }) + " · " + counts.map(([s, n]) => `${s.label} ${n}`).join(" · "), '<w:color w:val="5F6676"/>')),
      para(run(t("exp.overview")), "Heading1"),
      overview,
      ...counts.map(([s]) => para(run(s.label), "Heading1") + rows.filter((x) => x.status === s.id).map(school).join("")),
      para(run(t("exp.docNote"), '<w:color w:val="5F6676"/><w:sz w:val="18"/>')),
    ].join("\n");
    // Letter paper in English, A4 in Chinese; 0.75 in margins.
    const page = lang === "zh" ? 'w:w="11906" w:h="16838"' : 'w:w="12240" w:h="15840"';
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const docXml = HEAD + `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
${body}
<w:sectPr><w:pgSz ${page}/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
    const heading = (id, name, size, before, level) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="100"/>${level == null ? "" : `<w:outlineLvl w:val="${level}"/>`}</w:pPr><w:rPr><w:b/><w:color w:val="16305F"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="C9C5BA"/>`;
    const styles = HEAD + `<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="${lang === "zh" ? "zh-CN" : "en-US"}" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading("Title", "Title", 40, 0)}
${heading("Heading1", "heading 1", 30, 320, 0)}
${heading("Heading2", "heading 2", 24, 200, 1)}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F4F9C"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>
<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>`;
    const rels = HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>
${links.map((u, i) => `<Relationship Id="rId${i + 2}" Type="${R}/hyperlink" Target="${xml(u)}" TargetMode="External"/>`).join("\n")}
</Relationships>`;
    return zip([
      { name: "[Content_Types].xml", data: HEAD + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
      { name: "_rels/.rels", data: HEAD + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: "word/document.xml", data: docXml },
      { name: "word/styles.xml", data: styles },
      { name: "word/_rels/document.xml.rels", data: rels },
    ], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  function download(format) {
    const blob = { xlsx, csv, docx }[format]();
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${t("exp.filename")}-${stamp}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.Exporter = { download, xlsx, csv, docx };
})();
