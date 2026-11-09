# Fetch Extension

Registers a `fetch` tool that retrieves a URL and returns its contents as clean, readable markdown.

## How It Works

Pipeline:

1. HTTP → HTTPS upgrade
2. Fetch with 30s timeout
3. Reject binary content types
4. Readability article extraction
5. Turndown + GFM HTML → markdown conversion
6. Whitespace cleanup
7. Truncate to 100k characters

- **HTML pages**: Extracts article content using Mozilla's Readability, strips navigation/ads/boilerplate, converts to markdown with GFM table support
- **JSON**: Pretty-printed
- **Plain text**: Returned as-is
- **Binary**: Rejected (images, PDFs, archives, audio, video, fonts)

## Usage

The LLM calls the `fetch` tool automatically when it needs to retrieve web content. The tool accepts a single `url` parameter.

## Configuration

None. The extension works out of the box.

## Dependencies

- `@mozilla/readability` — article extraction
- `jsdom` — DOM parsing
- `turndown` + `turndown-plugin-gfm` — HTML to markdown
