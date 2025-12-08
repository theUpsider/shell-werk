This information sheet outlines how to integrate the Brave Search API into a Go application using the standard library.

### 1. Prerequisites

- **Sign Up:** Create an account at the [Brave Search API Dashboard](https://api.search.brave.com/app/dashboard) to obtain your API key.
- **Plan:** Choose a plan (Free, Base, or Pro). The free tier is sufficient for development and testing.

### 2. Quick Start (Standard Library)

This dependency-free example demonstrates how to query the Web Search endpoint using Go's `net/http` package.

```go
package main

import (
    "encoding/json"
    "fmt"
    "net/http"
    "net/url"
    "os"
    "time"
)

// Define the response structure you need
type BraveResponse struct {
    Web struct {
        Results []struct {
            Title       string `json:"title"`
            URL         string `json:"url"`
            Description string `json:"description"`
        } `json:"results"`
    } `json:"web"`
}

func main() {
    apiKey := "YOUR_API_KEY_HERE"
    query := "golang http request tutorial"

    // Build the request URL
    endpoint := "https://api.search.brave.com/res/v1/web/search"
    u, _ := url.Parse(endpoint)
    q := u.Query()
    q.Set("q", query)
    u.RawQuery = q.Encode()

    // Create the Request
    req, _ := http.NewRequest("GET", u.String(), nil)
    req.Header.Set("Accept", "application/json")
    req.Header.Set("Accept-Encoding", "gzip") // Recommended for performance
    req.Header.Set("X-Subscription-Token", apiKey)

    // Execute
    client := &http.Client{Timeout: 10 * time.Second}
    resp, err := client.Do(req)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    defer resp.Body.Close()

    // Parse Response
    var result BraveResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        fmt.Println("Decode error:", err)
        return
    }

    // Output
    for _, item := range result.Web.Results {
        fmt.Printf("Title: %s\nURL: %s\n\n", item.Title, item.URL)
    }
}
```

### 3. Key Request Details

- **Endpoint:** `https://api.search.brave.com/res/v1/web/search`[1]
- **Method:** `GET`
- **Required Headers:**
  - `Accept: application/json`
  - `Accept-Encoding: gzip` (Optional but highly recommended to reduce latency and bandwidth)
  - `X-Subscription-Token`: Your unique API key[1]

### 4. Important Query Parameters

| Parameter     | Type     | Description                                                  |
| :------------ | :------- | :----------------------------------------------------------- |
| `q`           | `string` | The search query (URL encoded). Required.                    |
| `count`       | `int`    | Number of results (1-20). Default is usually 20.             |
| `country`     | `string` | Country code (e.g., `US`, `DE`) to localize results.         |
| `search_lang` | `string` | Language code (e.g., `en`, `de`) to filter results.          |
| `safesearch`  | `string` | Filters: `off`, `moderate`, `strict`. Default is `moderate`. |

### 5. Available Go Libraries

If you prefer using a pre-built client rather than raw HTTP requests, the community maintains libraries that handle serialization and rate limiting for you.

- **go-brave-search**: A popular, idiomatic client.
  - _Install:_ `go get github.com/cnosuke/go-brave-search`
  - _Usage:_ simplifies the client creation to `bravesearch.NewClient("YOUR_KEY")`.[2]
- **brave-search**: Another option by Freespoke.
  - _Install:_ `go get dev.freespoke.com/brave-search`.[3]

[1](https://api-dashboard.search.brave.com/app/documentation)
[2](https://pkg.go.dev/github.com/cnosuke/go-brave-search)
[3](https://pkg.go.dev/dev.freespoke.com/brave-search)
[4](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)
[5](https://brave.com/search/api/)
[6](https://brave.com/search/api/tools/)
[7](https://www.layla-network.ai/post/how-to-create-a-brave-search-agent)
[8](https://brave.com/search/api/guides/use-with-open-webui/)
[9](https://github.com/jonathansampson/brave-search-scripts)
[10](https://docs.langchain.com/oss/python/integrations/tools/brave_search)
[11](https://brave.com/search/api/guides/)
[12](https://www.youtube.com/watch?v=XnDrPyMBBWg)
[13](https://www.reddit.com/r/OpenWebUI/comments/1ol5g7v/brave_api_doesnt_work/)
[14](https://api-dashboard.search.brave.com/app/documentation/summarizer-search/code-samples)
[15](https://github.com/Freespoke/brave-search)
[16](https://inception-project.github.io/documentation/latest/developer-guide)
[17](https://github.com/Freespoke/brave-search/blob/master/brave.go)
[18](https://brave.com/de/search/api/guides/category/anleitungen/)
[19](https://pypi.org/project/brave-search/)
[20](https://brave.com/ai/)
[21](https://apidog.com/blog/brave-search-api-mcp-server/)
