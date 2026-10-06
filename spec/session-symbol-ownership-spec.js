const fs = require("fs");
const os = require("os");
const path = require("path");

const until = async (check, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} timed out`);
};

describe("HTML document symbol ownership through the public hub", () => {
  let service, documentProvider, registry, root, editors, previousPaths, timeout;
  const peers = [
    "language-html",
    "language-gfm",
    "ide",
    "ide-html",
    "symbol-tree-sitter",
    "symbol",
  ];

  beforeAll(() => {
    timeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = timeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    previousPaths = lumine.project.getPaths();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ide-html-symbol-ownership-"));
    editors = [];
    for (const name of peers) await lumine.packages.activatePackage(name);
    const ide = lumine.packages.getActivePackage("ide").mainModule;
    service = ide.provideIde();
    documentProvider = ide.provideDocumentSymbolProvider();
    registry = lumine.packages.getActivePackage("symbol").mainModule.provideSymbolRegistry();
    lumine.project.setPaths([root]);
  });

  afterEach(async () => {
    for (const editor of editors) editor.destroy();
    for (const name of [...peers].reverse()) await lumine.packages.deactivatePackage(name);
    lumine.project.setPaths(previousPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const open = async (file, scope, text) => {
    const filePath = path.join(root, file);
    fs.writeFileSync(filePath, text);
    const editor = await lumine.workspace.open(filePath);
    editors.push(editor);
    editor.setGrammar(lumine.grammars.grammarForScopeName(scope));
    expect(await editor.whenGrammarSettled()).toBe(true);
    registry.setDocumentSource(editor, null);
    const session = await until(async () => {
      const sessions = await service.activeSessionsForEditor(editor);
      return sessions.find(
        ({ adapter, state }) => adapter.id === "ide-html" && state === "running",
      );
    }, "running HTML session");
    return { editor, session };
  };

  for (const [label, markup] of [
    ["without embedded HTML", "Paragraph text.\n"],
    ["with embedded HTML", '<section id="embedded">Markup</section>\n'],
  ]) {
    it(`keeps Markdown heading symbols ${label} while the HTML backend is running`, async () => {
      const { editor, session } = await open(
        "readme.md",
        "source.gfm",
        `# Main\n\n## Details\n\n${markup}`,
      );
      expect(session.capabilities.documentSymbolProvider).toBe(true);
      expect(session.supports("textDocument/documentSymbol", editor)).toBe(true);
      expect(session.supports("textDocument/completion", editor)).toBe(true);
      expect(session.supports("textDocument/hover", editor)).toBe(true);
      expect(documentProvider.getDocumentSymbolSources(editor)).toEqual([]);
      const request = spyOn(session, "request").and.callThrough();
      expect(
        await documentProvider.getDocumentSymbols(editor, { sourceId: "ide:ide-html" }),
      ).toBeNull();
      const sources = await registry.listDocumentSources(editor);
      expect(sources.map(({ id }) => id)).toContain("symbol-tree-sitter");
      expect(sources.map(({ id }) => id)).not.toContain("ide:ide-html");
      const symbols = await until(() => registry.getFileSymbols(editor), "Markdown symbols");
      expect(symbols.map(({ name }) => name)).toContain("· Main");
      expect(symbols.map(({ name }) => name)).toContain("·· Details");
      expect(symbols.every(({ providerName }) => providerName === "Tree-sitter")).toBe(true);
      expect(registry.getDocumentSourceState(editor).source.id).toBe("symbol-tree-sitter");
      expect(
        request.calls.allArgs().some(([method]) => method === "textDocument/documentSymbol"),
      ).toBe(false);
    });
  }

  it("uses native HTML language-server symbols in automatic selection", async () => {
    const { editor } = await open(
      "native.html",
      "text.html.basic",
      '<section id="native"><h1>Title</h1></section>\n',
    );
    const sources = await registry.listDocumentSources(editor);
    expect(sources.find(({ id }) => id === "ide:ide-html").state).toBe("ready");
    const symbols = await until(() => registry.getFileSymbols(editor), "native HTML symbols");
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every(({ providerName }) => providerName === "HTML Language Server")).toBe(true);
    expect(registry.getDocumentSourceState(editor).source.id).toBe("ide:ide-html");
  });
});
