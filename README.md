# ide-html

HTML language-server adapter.

Registers the HTML server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the bundled `ide-client` package, providing completion, hover, navigation, symbols, and formatting for HTML and template documents.

## Features

- **Bundled server**: ships an exact vscode-langservers-extracted version, with an optional custom executable path.
- **HTML intelligence**: completes standard elements, attributes, values, and closing tags.
- **Template grammars**: serves HTML, EJS, ERB, and Mustache documents under the HTML language identifier.
- **Embedded languages**: understands CSS and JavaScript embedded in HTML documents.
- **Formatting**: controls wrapping, protected content, attribute layout, indentation, and templating syntax.
- **Feature switches**: each capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first HTML editor.

## Installation

To install `ide-html` search for _ide-html_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/ide-html`.

## Services

- **ide-client** (`^1.0.0`): consumed to register the HTML adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
