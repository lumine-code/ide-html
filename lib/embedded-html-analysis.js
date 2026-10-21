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
function visibleRanges(context) {
  const buffer = context.getBuffer();
  const layers = context.getLanguageLayers();
  const ranges = [];
  const hidden = [];
  for (const layer of layers) {
    if (!layer) continue;
    const scope = layer.scopeName;
    if (scope === "text.html.basic") {
      for (const range of layer.ranges) ranges.push(offsetRange(buffer, range));
    } else if (scope === "text.html.php.blade") {
      // Blade embeds the HTML grammar in its root parser rather than creating
      // an HTML injection. Its expression nodes must stay out of the HTML
      // document, including expressions containing strings that look like tags.
      ranges.push(offsetRange(buffer, layer.extent));
      const nodes = layer.rootNode?.descendantsOfType(["php_only", "parameter", "comment"]);
      for (const node of nodes || []) {
        if (node.type === "comment" && !node.text.startsWith("{{--")) continue;
        hidden.push(offsetRange(buffer, node.range));
      }
    } else if (scope === "source.php.only") {
      // Blade component attributes bind PHP without a php_only node in the
      // outer tree. Their injection ranges identify the same hidden source.
      for (const range of layer.ranges) hidden.push(offsetRange(buffer, range));
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
  return visibleRanges;
}

exports.project = async (context, _params, { signal, emit }) => {
  const ranges = visibleRanges(context),
    text = context.getText();
  for (let index = 0; index < ranges.length; index += 256)
    await emit({ kind: "ranges", values: ranges.slice(index, index + 256) });
  let parts = [],
    units = 0;
  const append = async (start, end, hidden) => {
    while (start < end) {
      signal.throwIfAborted();
      const stop = Math.min(end, start + 65536 - units);
      let value = text.slice(start, stop);
      if (hidden) value = value.replace(/[^\r\n]/g, " ");
      parts.push(value);
      units += value.length;
      start = stop;
      if (units === 65536) {
        await emit({ kind: "text", value: parts.join("") });
        parts = [];
        units = 0;
      }
    }
  };
  let end = 0;
  for (const [start, stop] of ranges) {
    await append(end, start, true);
    await append(start, stop, false);
    end = stop;
  }
  await append(end, text.length, true);
  if (parts.length) await emit({ kind: "text", value: parts.join("") });
  return { length: text.length, ranges: ranges.length };
};
