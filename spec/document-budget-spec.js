const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TextBuffer } = require("lumine");

describe("HTML projection input budgets", () => {
  let Budget, project, directory;
  beforeEach(() => {
    jasmine.useRealClock();
    Budget = require("../lib/document-budget");
    project = require("../lib/embedded-html").getDocumentProjection;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-html-budget-"));
  });
  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function fakeEditor() {
    let length = 1,
      revision = 0;
    const source = TextBuffer.createTextSnapshot("x");
    const buffer = {
      isDestroyed: () => false,
      getLength: () => length,
      getTextRevision: () => revision,
      getLanguageMode: () => mode,
      getPath: () => "source.php",
      getTextSnapshot: jasmine.createSpy("source snapshot").and.returnValue(source),
      async analyzeSyntax() {
        length = 600000000;
        revision++;
        return { length: 1, ranges: 0 };
      },
    };
    const mode = {};
    return {
      getBuffer: () => buffer,
      getGrammar: () => ({ scopeName: "text.html.php" }),
      getSyntaxAvailability: () => ({ available: true }),
    };
  }

  it("rejects an oversized source before snapshot capture", async () => {
    const editor = fakeEditor();
    editor.getBuffer().getLength = () => 600000000;
    await expectAsync(project(editor)).toBeRejectedWithError(/protocol budget/);
    expect(editor.getBuffer().getTextSnapshot).not.toHaveBeenCalled();
  });

  it("checks source size again after an asynchronous projection becomes stale", async () => {
    const editor = fakeEditor();
    await expectAsync(project(editor)).toBeRejectedWithError(/protocol budget/);
    expect(editor.getBuffer().getTextSnapshot).toHaveBeenCalledTimes(1);
  });

  it("checks worker source metadata without materializing text", async () => {
    const analysis = require("../lib/embedded-html-analysis");
    const context = {
      getBuffer: () => ({ getTextSnapshot: () => ({ length: 600000000 }) }),
      getText: jasmine.createSpy("whole source").and.throwError("must not read"),
      getLanguageLayers: jasmine.createSpy("layers").and.throwError("must not inspect"),
    };
    await expectAsync(
      analysis.project(context, null, { signal: new AbortController().signal, emit() {} }),
    ).toBeRejectedWithError(/protocol budget/);
    expect(context.getText).not.toHaveBeenCalled();
    expect(context.getLanguageLayers).not.toHaveBeenCalled();
  });

  it("reads only the Blade comment prefix and preserves exact projection positions", async () => {
    const analysis = require("../lib/embedded-html-analysis");
    const text = "{{-- hidden 😀 --}}\r\n",
      source = TextBuffer.createTextSnapshot(text);
    const range = { start: { row: 0, column: 0 }, end: { row: 1, column: 0 } };
    const node = {
      type: "comment",
      range,
      startIndex: 0,
      endIndex: source.length,
      namedChildCount: 0,
      get text() {
        throw new Error("whole node source");
      },
    };
    const context = {
      getBuffer: () => ({
        getTextSnapshot: () => source,
        characterIndexForPosition: (position) => (position.row ? source.length : position.column),
      }),
      getLanguageLayers: () => [
        { scopeName: "text.html.php.blade", extent: range, rootNode: node },
      ],
      getText() {
        throw new Error("whole source");
      },
    };
    const packets = [];
    const result = await analysis.project(context, null, {
      signal: new AbortController().signal,
      emit: async (packet) => packets.push(packet),
    });
    expect(result.length).toBe(text.length);
    expect(
      packets
        .filter((packet) => packet.kind === "text")
        .map((packet) => packet.value)
        .join(""),
    ).toBe(text.replace(/[^\r\n]/g, " "));
  });

  it("bounds dense source intervals before emitting partial projection packets", async () => {
    const analysis = require("../lib/embedded-html-analysis");
    const range = { start: { column: 0 }, end: { column: 1 } },
      source = TextBuffer.createTextSnapshot("x");
    const context = {
      getBuffer: () => ({
        getTextSnapshot: () => source,
        characterIndexForPosition: (position) => position.column,
      }),
      getLanguageLayers: () => [
        { scopeName: "text.html.basic", ranges: new Array(100002).fill(range) },
      ],
    };
    const emit = jasmine.createSpy("emit");
    await expectAsync(
      analysis.project(context, null, { signal: new AbortController().signal, emit }),
    ).toBeRejectedWithError(/source intervals/);
    expect(emit).not.toHaveBeenCalled();
  });

  it("decodes complete bounded custom data and rejects sparse oversized files before reads", async () => {
    const file = path.join(directory, "data.json"),
      text = "ą😀".repeat(25000);
    fs.writeFileSync(file, text);
    expect(await Budget.readCustomData(file)).toBe(text);
    const fd = fs.openSync(file, "w");
    fs.ftruncateSync(fd, 600000000);
    fs.closeSync(fd);
    const original = fs.promises.open;
    let read, close;
    spyOn(fs.promises, "open").and.callFake(async (...args) => {
      const handle = await original(...args);
      read = spyOn(handle, "read").and.throwError("must not read");
      close = spyOn(handle, "close").and.callThrough();
      return handle;
    });
    await expectAsync(Budget.readCustomData(file)).toBeRejectedWithError(/protocol budget/);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("rejects custom-data growth while decoding and closes its handle", async () => {
    const file = path.join(directory, "growing.json");
    fs.writeFileSync(file, "x");
    const original = fs.promises.open;
    let close;
    spyOn(fs.promises, "open").and.callFake(async (...args) => {
      const handle = await original(...args),
        read = handle.read.bind(handle);
      let grown = false;
      spyOn(handle, "read").and.callFake(async (...readArgs) => {
        if (!grown) {
          grown = true;
          fs.appendFileSync(file, "x".repeat(Budget.CUSTOM_DATA_LIMIT));
        }
        return read(...readArgs);
      });
      close = spyOn(handle, "close").and.callThrough();
      return handle;
    });
    await expectAsync(Budget.readCustomData(file)).toBeRejectedWithError(/protocol budget/);
    expect(close).toHaveBeenCalled();
  });
});
