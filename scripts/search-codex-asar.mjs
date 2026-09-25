import fs from "node:fs";

const archive = process.argv[2];
if (!archive) throw new Error("Usage: search-codex-asar.mjs <app.asar>");
const searchTerm = process.argv[3];
const contextChars = Number(process.argv[4] ?? 240);
const maxResults = Number(process.argv[5] ?? 80);

const fd = fs.openSync(archive, "r");
try {
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, prefix.length, 0);
  const headerSize = prefix.readUInt32LE(12);
  const headerBytes = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBytes, 0, headerSize, 16);
  const header = JSON.parse(headerBytes.toString("utf8").replace(/\0+$/u, ""));
  const dataOffset = 16 + headerSize;
  const entries = [];

  function walk(node, parent = "") {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const path = parent ? `${parent}/${name}` : name;
      if (value.files) walk(value, path);
      else if (!value.unpacked && value.size != null && value.offset != null) {
        entries.push({ path, size: Number(value.size), offset: Number(value.offset) });
      }
    }
  }
  walk(header);

  const searchable = /\.(?:js|mjs|cjs|json|html|css)$/iu;
  const needle = searchTerm
    ? new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu")
    : /dictat(?:e|ion)|microphone|speech[-_ ]to[-_ ]text/giu;
  let resultCount = 0;
  for (const entry of entries) {
    if (!searchable.test(entry.path) || entry.size > 25_000_000) continue;
    const bytes = Buffer.alloc(entry.size);
    fs.readSync(fd, bytes, 0, entry.size, dataOffset + entry.offset);
    const text = bytes.toString("utf8");
    for (const match of text.matchAll(needle)) {
      const start = Math.max(0, match.index - contextChars);
      const end = Math.min(text.length, match.index + match[0].length + contextChars);
      const snippet = text.slice(start, end).replace(/\s+/gu, " ");
      console.log(JSON.stringify({ file: entry.path, match: match[0], snippet }));
      resultCount += 1;
      if (resultCount >= maxResults) process.exit(0);
    }
  }
} finally {
  fs.closeSync(fd);
}
