const EMBEDDED_SCOPES = new Set(["text.html.php", "text.html.php.blade", "source.gfm"]);

const isEmbeddedDocument = (editor) => EMBEDDED_SCOPES.has(editor?.getGrammar?.()?.scopeName);

const mask = (text) => text.replace(/[^\r\n]/g, " ");

function offsetRange(buffer, range) {
  return [
    buffer.characterIndexForPosition(range.start),
    buffer.characterIndexForPosition(range.end),
  ];
}

function mergeRanges(ranges) {
  const merged = [];
  for (const [start, stop] of ranges.sort(([a], [b]) => a - b)) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], stop);
    else merged.push([start, stop]);
  }
  return merged;
}

// A projection uses the buffer's UTF-16 offsets throughout. Replacing each
// hidden code unit with a space also keeps astral characters and CRLFs from
// shifting positions sent back by the language server.
function transformDocumentText(text, { editor }) {
  if (!isEmbeddedDocument(editor)) return text;
  const buffer = editor.getBuffer();
  const languageMode = buffer.getLanguageMode();
  const layers = languageMode.getAllLanguageLayers?.() || [];
  const ranges = [];
  const hidden = [];
  for (const layer of layers) {
    if (!layer) continue;
    const scope = layer.grammar?.scopeName;
    if (scope === "text.html.basic") {
      for (const range of layer.getCurrentRanges?.() || []) ranges.push(offsetRange(buffer, range));
    } else if (scope === "text.html.php.blade") {
      // Blade embeds the HTML grammar in its root parser rather than creating
      // an HTML injection. Its expression nodes must stay out of the HTML
      // document, including expressions containing strings that look like tags.
      ranges.push(offsetRange(buffer, layer.getExtent()));
      const nodes = layer.tree?.rootNode?.descendantsOfType(["php_only", "parameter", "comment"]);
      for (const node of nodes || []) {
        if (node.type === "comment" && !node.text.startsWith("{{--")) continue;
        hidden.push(offsetRange(buffer, node.range));
      }
    } else if (scope === "source.php.only") {
      // Blade component attributes bind PHP without a php_only node in the
      // outer tree. Their injection ranges identify the same hidden source.
      for (const range of layer.getCurrentRanges?.() || []) hidden.push(offsetRange(buffer, range));
    }
  }
  const hiddenRanges = mergeRanges(hidden);
  const visibleRanges = [];
  let hiddenIndex = 0;
  for (const [start, stop] of mergeRanges(ranges)) {
    let from = start;
    while (hiddenRanges[hiddenIndex]?.[1] <= from) hiddenIndex++;
    while (hiddenRanges[hiddenIndex]?.[0] < stop) {
      const [hiddenStart, hiddenStop] = hiddenRanges[hiddenIndex];
      if (from < hiddenStart) visibleRanges.push([from, hiddenStart]);
      from = Math.max(from, hiddenStop);
      if (hiddenStop > stop) break;
      hiddenIndex++;
    }
    if (from < stop) visibleRanges.push([from, stop]);
  }
  const pieces = [];
  let end = 0;
  for (const [start, stop] of visibleRanges) {
    if (start > end) pieces.push(mask(text.slice(end, start)));
    pieces.push(text.slice(start, stop));
    end = stop;
  }
  pieces.push(mask(text.slice(end)));
  return pieces.join("");
}

module.exports = { transformDocumentText, isEmbeddedDocument };
