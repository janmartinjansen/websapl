/**
 * WebSapl Virtual File Tree Component
 * Manages the UI representation of the Emscripten VFS and IndexedDB storage.
 */

class SaplFileTree {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = Object.assign({
      onSelectFile: null,
      onNewFile: null,
      onDeleteFile: null,
      onUploadFile: null
    }, options);

    this.fileData = {
      workspace: [],
      benchmarks: [],
      examples: [],
      lib: []
    };

    this.activePath = null;
    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="filetree-header">
        <span class="filetree-title">BESTANDEN</span>
        <div class="filetree-actions">
          <button class="icon-btn" id="btn-new-file" title="Nieuw bestand">+ 📄</button>
          <button class="icon-btn" id="btn-upload-file" title="Bestand uploaden">⬆</button>
          <button class="icon-btn" id="btn-refresh-tree" title="Vernieuwen">⟳</button>
          <button class="icon-btn" id="btn-close-filetree" title="Zijbalk inklappen">«</button>
        </div>
      </div>
      <div class="filetree-search-box">
        <input type="text" id="filetree-search" placeholder="Zoek bestand..." />
      </div>
      <div class="filetree-content" id="filetree-tree"></div>
      <input type="file" id="filetree-hidden-upload" style="display:none;" />
    `;

    this.treeEl = this.container.querySelector("#filetree-tree");
    this.searchInput = this.container.querySelector("#filetree-search");
    this.uploadInput = this.container.querySelector("#filetree-hidden-upload");

    this.container.querySelector("#btn-new-file").addEventListener("click", () => {
      this.promptNewFile();
    });

    this.container.querySelector("#btn-upload-file").addEventListener("click", () => {
      this.uploadInput.click();
    });

    this.container.querySelector("#btn-close-filetree").addEventListener("click", () => {
      if (this.options.onClose) this.options.onClose();
    });

    this.uploadInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file && this.options.onUploadFile) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          this.options.onUploadFile(file.name, evt.target.result);
        };
        reader.readAsText(file);
      }
      this.uploadInput.value = "";
    });

    this.searchInput.addEventListener("input", (e) => {
      this.filterTree(e.target.value.toLowerCase().trim());
    });
  }

  setTreeData(data) {
    this.fileData = Object.assign(this.fileData, data);
    this.render();
  }

  promptNewFile() {
    const filename = prompt("Voer de naam van het nieuwe bestand in (bijv. programma.cfp):", "nieuw.cfp");
    if (filename && filename.trim()) {
      const cleanName = filename.trim();
      const path = `/workspace/${cleanName}`;
      if (this.options.onNewFile) {
        this.options.onNewFile(path);
      }
    }
  }

  getFileIcon(name) {
    if (name.endsWith(".cfp")) return "🔷";
    if (name.endsWith(".jmvm")) return "⚙️";
    if (name.endsWith(".txt")) return "📝";
    return "📄";
  }

  render() {
    this.treeEl.innerHTML = "";

    const sections = [
      { id: "workspace", name: "workspace (Mijn project)", icon: "💾", items: this.fileData.workspace, isRoot: true },
      { id: "benchmarks", name: "benchmarks (12 tests)", icon: "⚡", items: this.fileData.benchmarks, isReadOnly: true },
      { id: "examples", name: "examples", icon: "💡", items: this.fileData.examples, isReadOnly: true },
      { id: "lib", name: "lib (stdlib)", icon: "📚", items: this.fileData.lib, isReadOnly: true }
    ];

    sections.forEach((sec) => {
      const folderEl = document.createElement("div");
      folderEl.className = "tree-folder open";
      folderEl.dataset.section = sec.id;

      const folderHeader = document.createElement("div");
      folderHeader.className = "folder-header";
      folderHeader.innerHTML = `
        <span class="folder-arrow">▼</span>
        <span class="folder-icon">${sec.icon}</span>
        <span class="folder-name">${sec.name}</span>
      `;

      folderHeader.addEventListener("click", () => {
        folderEl.classList.toggle("open");
        const arrow = folderHeader.querySelector(".folder-arrow");
        arrow.textContent = folderEl.classList.contains("open") ? "▼" : "▶";
      });

      const folderChildren = document.createElement("div");
      folderChildren.className = "folder-children";

      if (sec.items && sec.items.length > 0) {
        sec.items.forEach((item) => {
          const fileEl = this.renderItem(item, sec.isReadOnly);
          folderChildren.appendChild(fileEl);
        });
      } else {
        const emptyEl = document.createElement("div");
        emptyEl.className = "tree-empty";
        emptyEl.textContent = "(geen bestanden)";
        folderChildren.appendChild(emptyEl);
      }

      folderEl.appendChild(folderHeader);
      folderEl.appendChild(folderChildren);
      this.treeEl.appendChild(folderEl);
    });
  }

  renderItem(item, isReadOnly = false) {
    const itemEl = document.createElement("div");
    if (item.isDir) {
      itemEl.className = "tree-folder open";
      itemEl.innerHTML = `
        <div class="folder-header">
          <span class="folder-arrow">▼</span>
          <span class="folder-icon">📁</span>
          <span class="folder-name">${item.name}</span>
        </div>
        <div class="folder-children"></div>
      `;
      const childrenContainer = itemEl.querySelector(".folder-children");
      if (item.children) {
        item.children.forEach(child => childrenContainer.appendChild(this.renderItem(child, isReadOnly)));
      }
      return itemEl;
    }

    itemEl.className = `tree-file ${item.path === this.activePath ? "active" : ""}`;
    itemEl.dataset.path = item.path;

    const icon = this.getFileIcon(item.name);
    itemEl.innerHTML = `
      <span class="file-icon">${icon}</span>
      <span class="file-name" title="${item.path}">${item.name}</span>
      ${!isReadOnly ? `<button class="file-delete-btn" title="Verwijderen">&times;</button>` : ""}
    `;

    itemEl.addEventListener("click", (e) => {
      if (e.target.classList.contains("file-delete-btn")) {
        e.stopPropagation();
        if (confirm(`Weet je zeker dat je ${item.name} wilt verwijderen?`)) {
          if (this.options.onDeleteFile) this.options.onDeleteFile(item.path);
        }
        return;
      }
      this.setActivePath(item.path);
      if (this.options.onSelectFile) {
        this.options.onSelectFile(item.path, isReadOnly);
      }
    });

    return itemEl;
  }

  setActivePath(path) {
    this.activePath = path;
    const allFiles = this.treeEl.querySelectorAll(".tree-file");
    allFiles.forEach(f => {
      f.classList.toggle("active", f.dataset.path === path);
    });
  }

  filterTree(query) {
    const files = this.treeEl.querySelectorAll(".tree-file");
    files.forEach(f => {
      const name = f.querySelector(".file-name").textContent.toLowerCase();
      const matches = !query || name.includes(query);
      f.style.display = matches ? "flex" : "none";
    });
  }
}

window.SaplFileTree = SaplFileTree;
