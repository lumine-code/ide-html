# ide-html

HTML language-server adapter.

Registers the HTML server from [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted) with the `ide-client` package, providing pull diagnostics, completion, hover, navigation, symbols, and formatting for HTML and template documents.

## Features

- **Bundled server**: ships an exact vscode-langservers-extracted version, with an optional custom executable path.
- **Managed upgrade**: installs a newer server from npm when you want one, and removing it returns to the bundled copy.
- **HTML intelligence**: completes HTML, inline SVG and MathML elements, attributes, values, entities, and closing tags.
- **Template grammars**: serves HTML, EJS, ERB, Mustache, and embedded markup in PHP, Blade, and Markdown documents.
- **Embedded languages**: understands CSS and JavaScript embedded in HTML documents.
- **Custom data**: loads project-defined elements, attributes, values, and documentation from HTML custom-data files.
- **Formatting**: controls wrapping, protected content, attribute layout, indentation, and templating syntax.
- **Feature switches**: each capability can be handed to another language server serving the same file.
- **Project sessions**: one server per project root, started lazily with the first HTML editor.

## Installation

To install `ide-html` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/ide-html`.

Install `ide-client` first.

The bundled completion data supplements the server with SVG and MathML markup, language subtags, link relationships, editing options, and event handlers. Element names follow [W3C Webref](https://github.com/w3c/webref), HTML values follow the [HTML Standard](https://html.spec.whatwg.org/), and language suggestions use current two-letter primary subtags from [IANA](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry). Language tags can include additional script and region subtags. Project custom data adds to these suggestions.

PHP, Blade, and Markdown send only their markup to the HTML server while preserving document positions. Completion, hover and navigation remain available in that markup. Whole-document symbols and formatting stay with the host language; HTML document symbols are offered for HTML, EJS, ERB and Mustache buffers.

## Services

- `ide-client`: consumed to register the HTML adapter with the editor's language-server client.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
