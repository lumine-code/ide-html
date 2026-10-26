const { Point, Range } = require("lumine");
const EMBEDDED_SCOPES = new Set(["text.html.php", "text.html.php.blade", "source.gfm"]);
const isEmbeddedDocument = (editor) => EMBEDDED_SCOPES.has(editor?.getGrammar?.()?.scopeName);
const aborted = () =>
  Object.assign(new Error("HTML projection was superseded"), { name: "AbortError" });

async function getDocumentProjection(editor, { signal } = {}) {
  const buffer = editor.getBuffer();
  while (!buffer.isDestroyed()) {
    if (editor.getGrammar?.() === lumine.grammars.nullGrammar) return null;
    if (isEmbeddedDocument(editor) && editor.getSyntaxAvailability?.()?.available === false)
      return null;
    signal?.throwIfAborted();
    const revision = buffer.getTextRevision(),
      mode = buffer.getLanguageMode(),
      path = buffer.getPath();
    const epoch = mode.getSyntaxRequestEpoch?.() ?? mode.presentation?.generation;
    const snapshot = buffer.getTextSnapshot(),
      source = snapshot.toString();
    const currentText = () =>
      !buffer.isDestroyed() &&
      buffer.getTextRevision() === revision &&
      buffer.getLanguageMode() === mode &&
      buffer.getPath() === path;
    let text = source,
      ranges = [[0, source.length]];
    if (isEmbeddedDocument(editor)) {
      const parts = [];
      ranges = [];
      let length = 0;
      const result = await buffer.analyzeSyntax(
        require.resolve("./embedded-html-analysis"),
        "project",
        null,
        {
          signal,
          onChunk(packet) {
            if (packet.kind === "ranges") ranges.push(...packet.values);
            else {
              parts.push(packet.value);
              length += packet.value.length;
            }
          },
        },
      );
      signal?.throwIfAborted();
      if (
        !currentText() ||
        epoch !== (mode.getSyntaxRequestEpoch?.() ?? mode.presentation?.generation)
      )
        continue;
      if (!result) throw aborted();
      if (result.length !== length || result.ranges !== ranges.length || length !== source.length)
        throw new Error("Incomplete HTML projection stream");
      text = parts.join("");
    }
    const token = buffer.getSyntaxSnapshotToken();
    return createProjection(
      source,
      text,
      snapshot,
      ranges,
      () => currentText() && buffer.getSyntaxSnapshotToken() === token,
    );
  }
  throw aborted();
}

function createProjection(source, text, snapshot, visible, isCurrent) {
  const offset = (value) => {
    const point = Point.fromObject(value);
    if (
      !Number.isSafeInteger(point.row) ||
      point.row < 0 ||
      point.row >= snapshot.lineCount ||
      !Number.isSafeInteger(point.column) ||
      point.column < 0
    )
      return null;
    const start = snapshot.lineStart(point.row);
    let end =
      point.row + 1 < snapshot.lineCount ? snapshot.lineStart(point.row + 1) - 1 : snapshot.length;
    if (end > start && snapshot.slice(end - 1, end) === "\r") end--;
    return point.column <= end - start ? start + point.column : null;
  };
  const intervalAt = (index) => {
    let low = 0,
      high = visible.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (visible[middle][1] < index) low = middle + 1;
      else high = middle;
    }
    return visible[low]?.[0] <= index ? visible[low] : null;
  };
  const ownsPosition = (value) => {
    const index = offset(value);
    return index !== null && !!intervalAt(index);
  };
  const ownsRange = (value) => {
    const range = Range.fromObject(value),
      start = offset(range.start),
      end = offset(range.end);
    return start !== null && end !== null && end <= (intervalAt(start)?.[1] ?? -1);
  };
  const geometryRange = (value) => {
    const range = Range.fromObject(value);
    return offset(range.start) !== null && offset(range.end) !== null ? range : null;
  };
  return Object.freeze({
    source,
    text,
    isIdentity: text === source,
    isCurrent,
    ownsPosition,
    ownsRange,
    toServerPosition: (value) => (ownsPosition(value) ? Point.fromObject(value) : null),
    fromServerPosition: (value) => (offset(value) !== null ? Point.fromObject(value) : null),
    toServerRange: (value) => (ownsRange(value) ? Range.fromObject(value) : null),
    fromServerRange: geometryRange,
    mapEdits(edits) {
      if (!isCurrent() || !Array.isArray(edits)) return null;
      const mapped = [];
      for (const edit of edits) {
        if (typeof edit.newText !== "string" || !ownsRange(edit.oldRange)) return null;
        mapped.push({ ...edit, oldRange: Range.fromObject(edit.oldRange) });
      }
      return mapped;
    },
  });
}

module.exports = { getDocumentProjection, isEmbeddedDocument };
