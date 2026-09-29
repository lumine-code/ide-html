const fs = require("fs");
const os = require("os");
const path = require("path");
const { LiveLspClient, fileUri, position, positionParams } = require("./helpers/live-lsp-client");

const registerAdapter = () => {
  let adapter;
  const main = lumine.packages.getActivePackage("ide-html").mainModule;
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
      "<style>.card { background: #ff0000; color: ; }</style>",
      "<script>",
      "function greet(name, punctuation) { return name + punctuation; }",
      'const message = greet("world", "!");',
      'const again = greet("friend", "?");',
      "const broken = ;",
      "</script>",
      '<section id="target"><span>hello</span></section>',
      '<a href="./page.html">next</a>',
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
    expect(capabilities.documentHighlightProvider).toBe(true);
    expect(capabilities.documentLinkProvider).toBeDefined();
    expect(capabilities.colorProvider).toBeDefined();
    expect(capabilities.foldingRangeProvider).toBe(true);
    expect(capabilities.selectionRangeProvider).toBe(true);
    expect(capabilities.linkedEditingRangeProvider).toBe(true);

    const completion = await client.request("textDocument/completion", positionParams(uri, 10, 9));
    expect(completion.items.length).toBeGreaterThan(0);
    const resolved = await client.request("completionItem/resolve", completion.items[0]);
    expect(resolved.label).toBe(completion.items[0].label);

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

    const highlights = await client.request(
      "textDocument/documentHighlight",
      positionParams(uri, 10, 2),
    );
    expect(highlights.length).toBe(2);

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri },
    });
    expect(links[0].target.toLowerCase()).toContain("page.html");

    const colors = await client.request("textDocument/documentColor", {
      textDocument: { uri },
    });
    expect(colors).toHaveSize(1);
    const presentations = await client.request("textDocument/colorPresentation", {
      textDocument: { uri },
      color: colors[0].color,
      range: colors[0].range,
    });
    expect(presentations.map(({ label }) => label)).toContain("#ff0000");

    const folding = await client.request("textDocument/foldingRange", {
      textDocument: { uri },
    });
    expect(folding.length).toBeGreaterThan(0);

    const selection = await client.request("textDocument/selectionRange", {
      textDocument: { uri },
      positions: [position(10, 30)],
    });
    expect(selection[0].parent).toBeDefined();

    const linked = await client.request(
      "textDocument/linkedEditingRange",
      positionParams(uri, 10, 2),
    );
    expect(linked.ranges).toHaveSize(2);

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(edits[0].newText).toContain("  <section");

    const rangeEdits = await client.request("textDocument/rangeFormatting", {
      textDocument: { uri },
      range: { start: position(1, 0), end: position(13, 7) },
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

  it("completes project-defined HTML custom data", async () => {
    fs.writeFileSync(
      path.join(rootPath, "html-data.json"),
      JSON.stringify({
        version: 1,
        tags: [
          {
            name: "custom-panel",
            description: "Project panel element.",
            attributes: [{ name: "mode", values: [{ name: "compact" }, { name: "expanded" }] }],
          },
        ],
      }),
    );
    lumine.config.set("ide-html.customData", ["html-data.json"]);
    spyOn(adapter, "handleServerRequest").and.callThrough();
    const filePath = path.join(rootPath, "custom.html");
    const source = "<custom-";
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    await client.start();
    expect(adapter.handleServerRequest).toHaveBeenCalled();
    client.open(uri, "html", source);

    const completion = await client.waitFor(async () => {
      const result = await client.request("textDocument/completion", positionParams(uri, 0, 8));
      return result.items.some(({ label }) => label === "custom-panel") ? result : null;
    }, "HTML custom data");
    expect(completion.items.map(({ label }) => label)).toContain("custom-panel");
    expect(completion.items.map(({ label }) => label)).toContain("svg");
    expect(completion.items.map(({ label }) => label)).toContain("div");

    const values = '<custom-panel mode="">';
    client.change(uri, values);
    const modes = await client.request(
      "textDocument/completion",
      positionParams(uri, 0, values.indexOf('"') + 1),
    );
    expect(modes.items.map(({ label }) => label)).toEqual(["compact", "expanded"]);
  });

  it("supplements standard HTML with foreign markup and current attribute values", async () => {
    await client.start();
    const uri = fileUri(path.join(rootPath, "markup.html"));
    client.open(uri, "html", "<");
    const tags = await client.waitFor(async () => {
      const result = await client.request("textDocument/completion", positionParams(uri, 0, 1));
      return result.items.some(({ label }) => label === "svg") ? result : null;
    }, "bundled HTML data");
    const names = tags.items.map(({ label }) => label);
    for (const name of ["div", "svg", "path", "rect", "math", "mrow", "mfrac"])
      expect(names).withContext(name).toContain(name);
    expect(names).not.toContain("marquee");

    const cases = [
      ['<div contenteditable="|">', ["true", "false", "plaintext-only"]],
      ['<div autocapitalize="|">', ["none", "sentences", "words", "characters"]],
      ['<html lang="|">', ["en", "pl", "de", "fr", "zh"]],
      ['<link rel="|">', ["stylesheet", "preload", "modulepreload", "icon"]],
      ['<a rel="|">', ["noopener", "noreferrer", "nofollow"]],
      ["<div |>", ["oncopy", "onpaste", "onwheel", "ontoggle", "class", "popover"]],
      ["<svg |>", ["viewBox", "width", "height"]],
      ["<svg><path |></path></svg>", ["d", "fill", "stroke-width"]],
      ['<math display="|">', ["inline", "block"]],
      ['<math><mo form="|">+</mo></math>', ["prefix", "infix", "postfix"]],
      ['<math><mo stretchy="|">(</mo></math>', ["true", "false"]],
      ['<button type="|">', ["button", "submit", "reset"]],
    ];
    for (const [source, expected] of cases) {
      const character = source.indexOf("|");
      client.change(uri, source.replace("|", ""));
      const result = await client.request(
        "textDocument/completion",
        positionParams(uri, 0, character),
      );
      const labels = result.items.map(({ label }) => label);
      for (const label of expected)
        expect(labels).withContext(`${source}: ${label}`).toContain(label);
      expect(labels).withContext(source).not.toContain("innerText");
      expect(labels).withContext(source).not.toContain("ownerDocument");
    }

    client.change(uri, '<div lang="en"></div>');
    const hover = await client.request("textDocument/hover", positionParams(uri, 0, 6));
    expect(hover.contents.value).toContain("lang");
  });

  it("completes, renames, and formats HTML at an untitled URI", async () => {
    await client.start();
    const uri = "untitled:lumine-html-integration";
    client.open(uri, "html", "<di");
    const tags = await client.waitFor(async () => {
      const result = await client.request("textDocument/completion", positionParams(uri, 0, 3));
      return result.items.some(({ label }) => label === "svg") ? result : null;
    }, "untitled HTML completion");
    expect(tags.items.map(({ label }) => label)).toContain("div");

    client.change(uri, "<input ty>");
    const attributes = await client.request("textDocument/completion", positionParams(uri, 0, 9));
    const type = attributes.items.find(({ label }) => label === "type");
    expect(type.insertTextFormat).toBe(2);
    expect(type.textEdit.newText).toBe('type="$1"');

    client.change(uri, '<input type="te">', 3);
    const values = await client.request("textDocument/completion", positionParams(uri, 0, 15));
    expect(values.items.map(({ label }) => label)).toContain("text");

    client.change(uri, "<div><span>text</span></div>", 4);
    const rename = await client.request("textDocument/rename", {
      ...positionParams(uri, 0, 2),
      newName: "section",
    });
    expect(Object.keys(rename.changes)).toEqual([uri]);
    expect(rename.changes[uri].map(({ newText }) => newText)).toEqual(["section", "section"]);

    const formatting = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(formatting.length).toBeGreaterThan(0);
    expect(formatting.map(({ newText }) => newText).join("")).toContain("<span>text</span>");
  });

  it("keeps EJS, ERB, and Mustache syntax live under the HTML language ID", async () => {
    await client.start();
    const templates = [
      ["template.ejs", "text.html.ejs", "<div><%= user.name %></div>\n<sec"],
      ["template.erb", "text.html.erb", "<div><%= user.name %></div>\n<sec"],
      ["template.mustache", "text.html.mustache", "<div>{{user.name}}</div>\n<sec"],
    ];

    for (const [name, scope, source] of templates) {
      expect(adapter.languageIdForScope(scope)).toBe("html");
      const filePath = path.join(rootPath, name);
      fs.writeFileSync(filePath, source);
      const uri = fileUri(filePath);
      client.open(uri, "html", source);
      const completion = await client.request("textDocument/completion", positionParams(uri, 1, 4));
      expect(completion.items.map(({ label }) => label)).toContain("section");
      const edits = await client.request("textDocument/formatting", {
        textDocument: { uri },
        options: { tabSize: 2, insertSpaces: true },
      });
      expect(edits.map(({ newText }) => newText).join("\n")).toMatch(/user\.name/);
      client.closeDocument(uri);
    }
  });
});
