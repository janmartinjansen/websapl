/**
 * Pure JavaScript ZIP archive creator (zero dependencies)
 * Formats standard uncompressed (Stored) PKZIP files in browser.
 */
window.SimpleZip = class SimpleZip {
  constructor() {
    this.files = [];
  }

  addFile(path, content) {
    const encoder = new TextEncoder();
    const data = typeof content === "string" ? encoder.encode(content) : new Uint8Array(content);
    this.files.push({ path, data });
  }

  // Calculate CRC32 checksum
  _crc32(data) {
    let table = SimpleZip._crcTable;
    if (!table) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
      }
      SimpleZip._crcTable = table;
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  generateBlob() {
    let fileEntries = [];
    let centralDir = [];
    let offset = 0;

    const encoder = new TextEncoder();

    for (let file of this.files) {
      const nameBytes = encoder.encode(file.path);
      const data = file.data;
      const crc = this._crc32(data);
      const size = data.length;

      // Local file header (30 bytes + name)
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(localHeader.buffer);

      view.setUint32(0, 0x04034b50, true); // Local file header signature
      view.setUint16(4, 20, true);         // Version needed
      view.setUint16(6, 0, true);          // General purpose bit flag
      view.setUint16(8, 0, true);          // Compression method (0 = stored)
      view.setUint16(10, 0, true);         // File last mod time
      view.setUint16(12, 0, true);         // File last mod date
      view.setUint32(14, crc, true);       // CRC-32
      view.setUint32(18, size, true);      // Compressed size
      view.setUint32(22, size, true);      // Uncompressed size
      view.setUint16(26, nameBytes.length, true); // File name length
      view.setUint16(28, 0, true);         // Extra field length
      localHeader.set(nameBytes, 30);

      fileEntries.push(localHeader);
      fileEntries.push(data);

      // Central directory entry (46 bytes + name)
      const cdHeader = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cdHeader.buffer);

      cdView.setUint32(0, 0x02014b50, true); // Central directory header signature
      cdView.setUint16(4, 20, true);         // Version made by
      cdView.setUint16(6, 20, true);         // Version needed
      cdView.setUint16(8, 0, true);          // Bit flag
      cdView.setUint16(10, 0, true);         // Compression method
      cdView.setUint16(12, 0, true);         // Mod time
      cdView.setUint16(14, 0, true);         // Mod date
      cdView.setUint32(16, crc, true);       // CRC-32
      cdView.setUint32(20, size, true);      // Compressed size
      cdView.setUint32(24, size, true);      // Uncompressed size
      cdView.setUint16(28, nameBytes.length, true); // File name length
      cdView.setUint16(30, 0, true);         // Extra field length
      cdView.setUint16(32, 0, true);         // File comment length
      cdView.setUint16(34, 0, true);         // Disk number start
      cdView.setUint16(36, 0, true);         // Internal file attributes
      cdView.setUint32(38, 0, true);         // External file attributes
      cdView.setUint32(42, offset, true);     // Relative offset of local header
      cdHeader.set(nameBytes, 46);

      centralDir.push(cdHeader);

      offset += localHeader.length + size;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (let chunk of centralDir) {
      cdSize += chunk.length;
    }

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true);          // Disk number
    eocdView.setUint16(6, 0, true);          // Central dir disk
    eocdView.setUint16(8, this.files.length, true);  // Number of central dir records on this disk
    eocdView.setUint16(10, this.files.length, true); // Total number of central dir records
    eocdView.setUint32(12, cdSize, true);    // Size of central directory
    eocdView.setUint32(16, cdOffset, true);  // Offset of start of central directory
    eocdView.setUint16(20, 0, true);         // Comment length

    const allParts = [...fileEntries, ...centralDir, eocd];
    return new Blob(allParts, { type: "application/zip" });
  }
};
