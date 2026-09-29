describe("embedded HTML source projection", () => {
  let editor, projection;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-html");
    for (const name of ["language-html", "language-php", "language-blade", "language-gfm"])
      await lumine.packages.activatePackage(name);
    projection = require("../lib/embedded-html");
    editor = lumine.workspace.buildTextEditor();
  });

  afterEach(() => editor?.destroy());

  const project = async (scope, text) => {
    editor.setGrammar(lumine.grammars.grammarForScopeName(scope));
    editor.setText(text);
    expect(await editor.whenGrammarSettled()).toBe(true);
    const transformed = projection.transformDocumentText(text, { editor });
    expect(transformed.length).toBe(text.length);
    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\r" || text[index] === "\n")
        expect(transformed[index]).toBe(text[index]);
    }
    return transformed;
  };

  it("keeps HTML on both sides of PHP and hides tags inside PHP strings", async () => {
    const text = '<div class="before"><?php echo "<script>fake</script>"; ?>after</div>\r\n<p ti';
    const transformed = await project("text.html.php", text);
    expect(transformed.slice(0, text.indexOf("<?php"))).toBe('<div class="before">');
    expect(transformed).not.toContain("script");
    expect(transformed).toContain("after</div>\r\n<p ti");
  });

  it("preserves UTF-16 positions across an astral character in hidden PHP", async () => {
    const text = '<?php $emoji = "😀"; ?>\n<input type="te">';
    const transformed = await project("text.html.php", text);
    expect(transformed.indexOf("<input")).toBe(text.indexOf("<input"));
    expect(transformed.slice(0, text.indexOf("\n"))).toMatch(/^ +$/);
  });

  it("keeps Blade elements while masking expressions and directive arguments", async () => {
    const text = [
      '@if ($label === "<fake>")',
      '<div class="card">{{ "<script>fake</script>" }}</div>',
      "{{-- <aside>comment</aside> --}}",
      '<x-alert :message="$label" />',
      '<input type="te">',
      "@endif",
    ].join("\n");
    const transformed = await project("text.html.php.blade", text);
    expect(transformed).toContain('<div class="card">');
    expect(transformed).toContain('<input type="te">');
    expect(transformed).not.toContain("<fake>");
    expect(transformed).not.toContain("script");
    expect(transformed).not.toContain("aside");
    expect(transformed).not.toContain("$label");
  });

  it("projects Markdown HTML blocks and inline tags while hiding ordinary fenced code", async () => {
    const text = [
      "# Heading 😀",
      "",
      "```js",
      'const ignored = "<fake>";',
      "```",
      "",
      '<section class="card">hello</section>',
      "",
      'Inline <span title="greeting">text</span>.',
      "",
    ].join("\n");
    const transformed = await project("source.gfm", text);
    expect(transformed).not.toContain("Heading");
    expect(transformed).not.toContain("fake");
    expect(transformed).toContain('<section class="card">hello</section>');
    expect(transformed).toContain('<span title="greeting">');
    expect(transformed).toContain("</span>");
    expect(transformed.indexOf("<section")).toBe(text.indexOf("<section"));
  });

  it("leaves ordinary HTML unchanged", async () => {
    const text = '<script>const value = "<span>";</script>\n<div cl';
    expect(await project("text.html.basic", text)).toBe(text);
    expect(projection.isEmbeddedDocument(editor)).toBe(false);
  });

  it("completes projected PHP, Blade and Markdown at their original document positions", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const { LiveLspClient, fileUri, positionParams } = require("./helpers/live-lsp-client");
    const main = lumine.packages.getActivePackage("ide-html").mainModule;
    let adapter;
    const registration = main.consumeIdeClient({
      registerAdapter(value) {
        adapter = value;
        return { dispose() {} };
      },
      getSessions: () => [],
      restart: async () => {},
    });
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "embedded-html-lsp-"));
    const client = new LiveLspClient(adapter, rootPath);
    try {
      await client.start();
      const fixtures = [
        ["text.html.php", "before.php", '<?php $text = "<fake>"; ?>\n<div cl'],
        ["text.html.php.blade", "before.blade.php", '@if ($text === "<fake>")\n<div cl\n@endif'],
        ["source.gfm", "before.md", '# Header\n\n```js\nconst text = "<fake>";\n```\n\n<div cl'],
      ];
      for (const [scope, name, text] of fixtures) {
        const transformed = await project(scope, text);
        const uri = fileUri(path.join(rootPath, name));
        client.open(uri, "html", transformed);
        const prefix = text.slice(0, text.indexOf("<div cl") + "<div cl".length).split("\n");
        const completion = await client.request(
          "textDocument/completion",
          positionParams(uri, prefix.length - 1, prefix.at(-1).length),
        );
        expect(completion.items.some(({ label }) => label === "class"))
          .withContext(scope)
          .toBe(true);
        client.closeDocument(uri);
      }
    } finally {
      await client.stop();
      registration.dispose();
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });
});
