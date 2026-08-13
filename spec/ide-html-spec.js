const fs = require("fs");
const { resolveServer, managedServer } = require("../lib/server");
const main = require("../lib/main");

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

describe("ide-html server resolution", () => {
  it("prefers the configured path", async () => {
    const launch = await resolveServer(process.execPath);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--stdio"]);
  });

  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.args[1]).toBe("--stdio");
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/server.js", version: "9.9.9" };
    const launch = await resolveServer("", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    // Reported in the session details, so which copy is running is visible.
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("declares the bundled floor so uninstall falls back", () => {
    // The dependency is always present, so removing the managed copy returns to
    // a working server rather than to none.
    expect(managedServer.source).toBe("npm");
    expect(managedServer.bundled).toBe(true);
    expect(managedServer.module).toContain("node_modules/");
  });
});

describe("ide-html adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-html");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-html");
  });

  it("registers every bundled HTML grammar with the language-server service", async () => {
    expect(adapter.id).toBe("ide-html");
    expect(adapter.grammarScopes).toEqual([
      "text.html.basic",
      "text.html.ejs",
      "text.html.erb",
      "text.html.mustache",
    ]);
    expect(adapter.languageIdForScope("text.html.erb")).toBe("html");
    expect(adapter.settingsKeyPaths).toEqual(["ide-html"]);
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
  });

  it("enables embedded languages and the formatter during initialization", () => {
    expect(adapter.getInitializationOptions()).toEqual({
      provideFormatter: true,
      embeddedLanguages: { css: true, javascript: true },
    });
    lumine.config.set("ide-html.features.format", false);
    expect(adapter.getInitializationOptions().provideFormatter).toBe(false);
    expect(adapter.getSettings().html.format.enable).toBe(false);
  });

  it("transcribes completion, hover and formatter settings", () => {
    lumine.config.set("ide-html.html.attributeDefaultValue", "singlequotes");
    lumine.config.set("ide-html.html.hoverReferences", false);
    lumine.config.set("ide-html.html.format.wrapAttributes", "force-aligned");
    lumine.config.set("ide-html.html.format.indentInnerHtml", true);

    const html = adapter.getWorkspaceConfiguration("html");
    expect(html.completion.attributeDefaultValue).toBe("singlequotes");
    expect(html.hover.references).toBe(false);
    expect(html.format.wrapAttributes).toBe("force-aligned");
    expect(html.format.indentInnerHtml).toBe(true);
    expect(adapter.getWorkspaceConfiguration("css")).toEqual({});
    expect(adapter.getWorkspaceConfiguration("javascript")).toEqual({});
    expect(adapter.getWorkspaceConfiguration("js/ts")).toEqual({
      implicitProjectConfig: {},
    });
    expect(adapter.getWorkspaceConfiguration("unknown")).toBeUndefined();
  });

  it("turns off both embedded validators with the diagnostics feature", () => {
    expect(adapter.getWorkspaceConfiguration("html").validate).toEqual({
      scripts: true,
      styles: true,
    });
    lumine.config.set("ide-html.features.diagnostics", false);
    expect(adapter.getWorkspaceConfiguration("html").validate).toEqual({
      scripts: false,
      styles: false,
    });
  });

  it("offers switches for exactly the capabilities the server advertises", () => {
    const { configSchema } = require("../package.json");
    expect(Object.keys(configSchema.features.properties)).toEqual([
      "diagnostics",
      "autocomplete",
      "hover",
      "signature",
      "definition",
      "references",
      "symbols",
      "outline",
      "format",
      "rename",
    ]);
  });
});

describe("ide-html feature contracts", () => {
  const features = [
    "diagnostics",
    "autocomplete",
    "hover",
    "signature",
    "definition",
    "references",
    "symbols",
    "outline",
    "format",
    "rename",
  ];
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-html");
  });

  afterEach(async () => {
    for (const feature of features) lumine.config.unset(`ide-html.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-html");
  });

  for (const feature of features) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-html.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
