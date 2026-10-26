const Budget = require("./document-budget");

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
async function visibleRanges(context, source, signal) {
  const buffer = context.getBuffer();
  const layers = context.getLanguageLayers();
  const ranges = [];
  const hidden = [];
  let work = 0;
  const check = () => {
    signal.throwIfAborted();
    if (++work > 1000000) throw Budget.failure("projection exceeds its syntax-node budget.");
    if (ranges.length + hidden.length > Budget.RANGE_LIMIT)
      throw Budget.failure("projection has too many source intervals.");
  };
  for (const layer of layers) {
    check();
    if (!layer) continue;
    const scope = layer.scopeName;
    if (scope === "text.html.basic") {
      for (const range of layer.ranges) {
        check();
        ranges.push(offsetRange(buffer, range));
      }
    } else if (scope === "text.html.php.blade") {
      // Blade embeds the HTML grammar in its root parser rather than creating
      // an HTML injection. Its expression nodes must stay out of the HTML
      // document, including expressions containing strings that look like tags.
      ranges.push(offsetRange(buffer, layer.extent));
      const stack = layer.rootNode ? [{ node: layer.rootNode, index: -1 }] : [];
      while (stack.length) {
        if (stack.length > 4096)
          throw Budget.failure("projection exceeds its syntax-depth budget.");
        const frame = stack.at(-1),
          node = frame.node;
        if (frame.index === -1) {
          check();
          if ((work & 255) === 0) await new Promise((resolve) => setImmediate(resolve));
          if (
            ["php_only", "parameter", "comment"].includes(node.type) &&
            (node.type !== "comment" ||
              source.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 4)) ===
                "{{--")
          )
            hidden.push(offsetRange(buffer, node.range));
          frame.index = 0;
        }
        if (frame.index < node.namedChildCount)
          stack.push({ node: node.namedChild(frame.index++), index: -1 });
        else stack.pop();
      }
    } else if (scope === "source.php.only") {
      // Blade component attributes bind PHP without a php_only node in the
      // outer tree. Their injection ranges identify the same hidden source.
      for (const range of layer.ranges) {
        check();
        hidden.push(offsetRange(buffer, range));
      }
    }
  }
  check();
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
    if (visibleRanges.length > Budget.RANGE_LIMIT)
      throw Budget.failure("projection has too many source intervals.");
  }
  return visibleRanges;
}

exports.project = async (context, _params, { signal, emit }) => {
  const source = context.getBuffer().getTextSnapshot();
  Budget.assertLength(source.length);
  const ranges = await visibleRanges(context, source, signal);
  for (let index = 0; index < ranges.length; index += 256)
    await emit({ kind: "ranges", values: ranges.slice(index, index + 256) });
  let parts = [],
    units = 0;
  const append = async (start, end, hidden) => {
    while (start < end) {
      signal.throwIfAborted();
      const stop = Math.min(end, start + 65536 - units);
      let value = source.slice(start, stop);
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
  await append(end, source.length, true);
  if (parts.length) await emit({ kind: "text", value: parts.join("") });
  return { length: source.length, ranges: ranges.length };
};
