const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { resolveServer, managedServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-html.${key}`);
const optional = (value) => (value == null ? undefined : value);

const customDataPaths = (rootPath) =>
  (setting("customData") || []).map((entry) => pathToFileURL(path.resolve(rootPath, entry)).href);

const htmlSettings = () => ({
  completion: {
    attributeDefaultValue: setting("html.attributeDefaultValue"),
  },
  suggest: {
    html5: setting("html.suggestHtml5"),
    hideEndTagSuggestions: setting("html.hideEndTagSuggestions"),
  },
  validate: {
    scripts: setting("html.validateScripts"),
    styles: setting("html.validateStyles"),
  },
  hover: {
    documentation: setting("html.hoverDocumentation"),
    references: setting("html.hoverReferences"),
  },
  format: {
    // The client router owns the grammar-scoped feature switch. Keeping the
    // server enabled preserves a scoped true override of a false base value.
    enable: true,
    wrapLineLength: setting("html.format.wrapLineLength"),
    unformatted: setting("html.format.unformatted"),
    contentUnformatted: setting("html.format.contentUnformatted"),
    indentInnerHtml: setting("html.format.indentInnerHtml"),
    preserveNewLines: setting("html.format.preserveNewLines"),
    maxPreserveNewLines: optional(setting("html.format.maxPreserveNewLines")),
    indentHandlebars: setting("html.format.indentHandlebars"),
    endWithNewline: setting("html.format.endWithNewline"),
    extraLiners: setting("html.format.extraLiners"),
    wrapAttributes: setting("html.format.wrapAttributes"),
    wrapAttributesIndentSize: optional(setting("html.format.wrapAttributesIndentSize")),
    indentScripts: setting("html.format.indentScripts"),
    templating: setting("html.format.templating"),
    unformattedContentDelimiter: setting("html.format.unformattedContentDelimiter"),
  },
});

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-html",
      displayName: "HTML Language Server",
      grammarScopes: ["text.html.basic", "text.html.ejs", "text.html.erb", "text.html.mustache"],
      languageIdForScope: () => "html",
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-html"],
      restartKeyPaths: ["ide-html.serverPath", "ide-html.customData"],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions({ rootPath = process.cwd() } = {}) {
        return {
          provideFormatter: true,
          embeddedLanguages: { css: true, javascript: true },
          dataPaths: customDataPaths(rootPath),
        };
      },
      getSettings() {
        return { html: htmlSettings() };
      },
      getWorkspaceConfiguration(section) {
        if (!section) return { html: htmlSettings() };
        if (section === "html") return htmlSettings();
        // vscode-html-language-server requests all four sections as one batch,
        // then dereferences this nested object without guarding a missing
        // implicitProjectConfig. Empty compatibility-shaped defaults keep
        // embedded JavaScript validation alive without inventing settings.
        if (section === "js/ts") return { implicitProjectConfig: {} };
        if (section === "css" || section === "javascript") return {};
        return undefined;
      },
      async handleServerRequest(method, params, { session } = {}) {
        if (method !== "html/customDataContent") return null;
        const uri = Array.isArray(params) && params.length === 1 ? params[0] : params;
        const allowed = new Set(customDataPaths(session?.rootPath || process.cwd()));
        if (typeof uri !== "string" || !allowed.has(uri))
          throw new Error("The HTML server requested an unconfigured custom-data file.");
        return fs.promises.readFile(fileURLToPath(uri), "utf8");
      },
    };

    return service.registerAdapter(adapter);
  },
};
