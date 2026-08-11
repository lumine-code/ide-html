const { CompositeDisposable } = require("lumine");
const { resolveServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-html.${key}`);

const htmlSettings = () => ({
  completion: {
    attributeDefaultValue: setting("html.attributeDefaultValue"),
  },
  suggest: {
    html5: setting("html.suggestHtml5"),
    hideEndTagSuggestions: setting("html.hideEndTagSuggestions"),
  },
  validate: {
    scripts: setting("features.diagnostics") && setting("html.validateScripts"),
    styles: setting("features.diagnostics") && setting("html.validateStyles"),
  },
  hover: {
    documentation: setting("html.hoverDocumentation"),
    references: setting("html.hoverReferences"),
  },
  format: {
    enable: setting("features.format"),
    wrapLineLength: setting("html.format.wrapLineLength"),
    unformatted: setting("html.format.unformatted"),
    contentUnformatted: setting("html.format.contentUnformatted"),
    indentInnerHtml: setting("html.format.indentInnerHtml"),
    preserveNewLines: setting("html.format.preserveNewLines"),
    indentHandlebars: setting("html.format.indentHandlebars"),
    extraLiners: setting("html.format.extraLiners"),
    wrapAttributes: setting("html.format.wrapAttributes"),
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
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"));
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          provideFormatter: setting("features.format"),
          embeddedLanguages: { css: true, javascript: true },
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
    };

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    const restart = () => {
      for (const session of service.getSessions()) {
        if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
          continue;
        service.restart(session).catch((error) => {
          lumine.notifications.addError("Unable to restart HTML Language Server", {
            detail: error.message,
            dismissable: true,
          });
        });
      }
    };
    for (const key of ["serverPath", "features.format"]) {
      subscriptions.add(lumine.config.onDidChange(`ide-html.${key}`, restart));
    }
    return subscriptions;
  },
};
