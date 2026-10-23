# Web Search Extension

Registers a `web_search` tool that searches the web using the [Brave Search API](https://brave.com/search/api/). Returns the top 10 results with title, URL, and snippet.

Free tier: 1,000 queries/month.

## Configuration

Requires a Brave Search API key. This can be provided via an environment variable or settings.

### Environment Variable

```sh
export BRAVE_SEARCH_API_KEY="..."
```

### Settings File

`web-search.json` (3-tier loading):

| Tier    | Path                                        |
| ------- | ------------------------------------------- |
| Global  | `~/<agent-dir>/web-search.json`             |
| Project | `<repo-root>/.agents/web-search.json`       |
| Local   | `<repo-root>/.agents/web-search.local.json` |

```json
{
    "apiKey": "..."
}
```

The environment variable takes precedence over settings files.

## Behavior

- If the API key is missing, the tool returns a configuration error message and a startup widget shows the missing key
- Results are formatted as a numbered list with title, link, and snippet
