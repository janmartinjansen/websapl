const fs = require("fs");
const path = require("path");

const WEBSAPL_DIR = path.resolve(__dirname, "..");

// App-shell/tooling files at websapl's own root -- not Sapl content, so kept
// out of the browsable tree (they're still served as real files, just not
// listed as an entry). README.md stays visible on purpose.
const ROOT_FILE_EXCLUDES = new Set(["index.html", "graphics.html", "manifest.json", "server.js"]);

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
    if (!relBase && entry.isFile() && ROOT_FILE_EXCLUDES.has(entry.name)) {
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
        _expanded: false
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = [".pdf", ".wasm", ".png", ".jpg", ".ico"].includes(ext);

      items.push({
        name: entry.name,
        path: relPath,
        type: "file",
        ext: ext,
        size: fs.statSync(fullPath).size,
        isBinary: isBinary
      });
    }
  }
  return items;
}

const tree = scanDirectory(WEBSAPL_DIR);

const manifestContent = `// Auto-generated WebSapl Tree Manifest
window.WEBSAPL_TREE = ${JSON.stringify(tree, null, 2)};
`;

fs.writeFileSync(path.join(WEBSAPL_DIR, "js/manifest.js"), manifestContent, "utf-8");
fs.writeFileSync(path.join(WEBSAPL_DIR, "manifest.json"), JSON.stringify({ tree }, null, 2), "utf-8");
console.log("✓ Generated websapl/js/manifest.js and manifest.json with", tree.length, "top-level folders");
