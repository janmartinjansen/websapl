const fs = require("fs");
const path = require("path");

const WEBSAPL_DIR = path.resolve(__dirname, "..");

function scanDirectory(dirPath, relBase = "") {
  const items = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // Sort directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "tools" || entry.name === "css" || entry.name === "js" || entry.name === "engine") {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = scanDirectory(fullPath, relPath);
      items.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children: children,
        _expanded: (relBase === "" || relPath === "paper_examples" || relPath === "benchmarks")
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = [".pdf", ".wasm", ".png", ".jpg", ".ico"].includes(ext);
      let content = "";
      if (!isBinary) {
        content = fs.readFileSync(fullPath, "utf-8");
      }

      items.push({
        name: entry.name,
        path: relPath,
        type: "file",
        ext: ext,
        size: fs.statSync(fullPath).size,
        isBinary: isBinary,
        content: content
      });
    }
  }
  return items;
}

const tree = scanDirectory(WEBSAPL_DIR);

// Also encode saplcomp.jmvm and retagcomp.jmvm for fallback embedding
const saplcompPath = path.join(WEBSAPL_DIR, "engine/saplcomp.jmvm");
const retagcompPath = path.join(WEBSAPL_DIR, "engine/retagcomp.jmvm");

let saplcompBase64 = "";
if (fs.existsSync(saplcompPath)) {
  saplcompBase64 = fs.readFileSync(saplcompPath).toString("base64");
}

let retagcompBase64 = "";
if (fs.existsSync(retagcompPath)) {
  retagcompBase64 = fs.readFileSync(retagcompPath).toString("base64");
}

const manifestContent = `// Auto-generated WebSapl Bundled Files Manifest
window.WEBSAPL_MANIFEST = {
  tree: ${JSON.stringify(tree, null, 2)},
  saplcompBase64: "${saplcompBase64}",
  retagcompBase64: "${retagcompBase64}"
};
`;

fs.writeFileSync(path.join(WEBSAPL_DIR, "js/bundled_files.js"), manifestContent, "utf-8");
console.log("✓ Generated websapl/js/bundled_files.js with", tree.length, "top-level folders");
