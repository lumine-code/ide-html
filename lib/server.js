// Where the editor can fetch a newer server than the one this package pins.
//
// An upgrade tier, not the only way in: the dependency below is always present,
// so uninstalling drops back to it and can never leave the user with nothing.
exports.managedServer = {
  source: "npm",
  displayName: "HTML Language Server",
  packages: ["vscode-langservers-extracted"],
  module: "node_modules/vscode-langservers-extracted/bin/vscode-html-language-server",
  bundled: true,
};

exports.resolveServer = async (context, configuredPath) => {
  const selection = await context.resolver.select({
    configuredPath,
    configuredKind: "auto",
    managedPath: context.managedServer?.modulePath,
    managedVersion: context.managedServer?.version,
    bundledPath: () =>
      require.resolve("vscode-langservers-extracted/bin/vscode-html-language-server"),
    kind: "node",
    allowShellWrapper: true,
  });
  if (!selection) return null;
  return context.resolver.launch(selection, {
    args: ["--stdio"],
    cwd: context.rootPath,
    transport: "stdio",
  });
};
