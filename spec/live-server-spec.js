const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri, position, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

describe("ide-html bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-html");
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-html-live-"));
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    fs.rmSync(rootPath, { recursive: true, force: true });
    await lumine.packages.deactivatePackage("ide-html");
  });

  it("exercises every advertised feature and the document lifecycle", async () => {
    const filePath = path.join(rootPath, "fixture.html");
    const source = [
      "<!doctype html>",
      "<html>",
      "<body>",
      "<style>.card { color: ; }</style>",
      "<script>",
      "function greet(name, punctuation) { return name + punctuation; }",
      'const message = greet("world", "!");',
      'const again = greet("friend", "?");',
      "const broken = ;",
      "</script>",
      '<section id="target"><span>hello</span></section>',
      "</body>",
      "</html>",
      "",
    ].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    const { capabilities } = await client.start();
    client.open(uri, "html", source);

    expect(capabilities.diagnosticProvider).toBeDefined();
    expect(capabilities.completionProvider).toBeDefined();
    expect(capabilities.hoverProvider).toBe(true);
    expect(capabilities.signatureHelpProvider).toBeDefined();
    expect(capabilities.definitionProvider).toBe(true);
    expect(capabilities.referencesProvider).toBe(true);
    expect(capabilities.documentSymbolProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.documentRangeFormattingProvider).toBe(true);
    expect(capabilities.renameProvider).toBe(true);

    const completion = await client.request("textDocument/completion", positionParams(uri, 10, 9));
    expect(completion.items.length).toBeGreaterThan(0);

    const hover = await client.request("textDocument/hover", positionParams(uri, 10, 2));
    expect(hover.contents.value).toContain("section element");

    const signature = await client.request(
      "textDocument/signatureHelp",
      positionParams(uri, 6, 30),
    );
    expect(signature.signatures[0].label).toContain("greet(");
    expect(signature.activeParameter).toBe(1);

    const definition = await client.request("textDocument/definition", positionParams(uri, 6, 18));
    expect(definition[0].range.start.line).toBe(5);

    const references = await client.request("textDocument/references", {
      ...positionParams(uri, 6, 18),
      context: { includeDeclaration: true },
    });
    expect(references.length).toBe(3);

    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols.some(({ name }) => name === "section#target")).toBe(true);
    expect(symbols.some(({ name }) => name === "greet")).toBe(true);

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(edits[0].newText).toContain("  <section");

    const rangeEdits = await client.request("textDocument/rangeFormatting", {
      textDocument: { uri },
      range: { start: position(1, 0), end: position(12, 7) },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(rangeEdits.length).toBeGreaterThan(0);

    const rename = await client.request("textDocument/rename", {
      ...positionParams(uri, 10, 2),
      newName: "article",
    });
    expect(rename.changes[uri].map(({ newText }) => newText)).toEqual(["article", "article"]);

    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.kind).toBe("full");
    expect(diagnostics.items.map(({ source }) => source)).toEqual(["css", "javascript"]);

    const fixed = source
      .replace("color: ;", "color: red;")
      .replace("const broken = ;", "const broken = 1;");
    client.change(uri, fixed);
    const cleared = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(cleared.items).toEqual([]);

    client.closeDocument(uri);
    const closed = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(closed.items).toEqual([]);
  });
});
