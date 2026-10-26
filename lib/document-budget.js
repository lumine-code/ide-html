const DOCUMENT_LIMIT = 32 * 1024 * 1024;
const CUSTOM_DATA_LIMIT = 8 * 1024 * 1024;
const RANGE_LIMIT = 100000;
const failure = (detail) =>
  Object.assign(new Error(`HTML language-server ${detail}`), { code: "ERR_HTML_DOCUMENT_BUDGET" });
function assertLength(length, limit = DOCUMENT_LIMIT) {
  if (!Number.isSafeInteger(length) || length < 0 || length > limit)
    throw failure("input exceeds its protocol budget.");
}
async function readCustomData(file, signal) {
  const fs = require("node:fs").promises;
  const { StringDecoder } = require("node:string_decoder");
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (before.size > BigInt(CUSTOM_DATA_LIMIT * 4))
      throw failure("custom-data file exceeds its protocol budget.");
    const decoder = new StringDecoder("utf8"),
      buffer = Buffer.allocUnsafe(65536),
      parts = [];
    let units = 0,
      bytes = 0;
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > CUSTOM_DATA_LIMIT * 4)
        throw failure("custom-data file grew beyond its protocol budget.");
      const part = decoder.write(buffer.subarray(0, bytesRead));
      units += part.length;
      assertLength(units, CUSTOM_DATA_LIMIT);
      parts.push(part);
    }
    const tail = decoder.end();
    assertLength(units + tail.length, CUSTOM_DATA_LIMIT);
    parts.push(tail);
    const after = await handle.stat({ bigint: true }),
      current = await fs.stat(file, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
      if (before[key] !== after[key] || after[key] !== current[key])
        throw new Error("HTML custom data changed while reading.");
    signal?.throwIfAborted();
    return parts.join("");
  } finally {
    await handle.close();
  }
}
module.exports = {
  DOCUMENT_LIMIT,
  CUSTOM_DATA_LIMIT,
  RANGE_LIMIT,
  assertLength,
  failure,
  readCustomData,
};
