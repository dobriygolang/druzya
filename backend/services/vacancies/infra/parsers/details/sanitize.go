// sanitize.go — server-side HTML sanitiser shared by every detail fetcher.
//
// The four upstreams we control (Yandex, WB, MTS, VK) all return HTML
// fragments with structural markup we want to render: <p>, <ul>/<ol>/<li>,
// <h3>/<h4>, <strong>/<em>, <br>, <a href>. Anything outside this allow
// list (script, iframe, style, on* attrs, javascript: URLs) is stripped.
//
// We sanitise on the BACKEND so the frontend can use a plain
// dangerouslySetInnerHTML against pre-cleaned content; this avoids
// dragging dompurify into the bundle just to validate already-trusted
// upstream content.
package details

import (
	"bytes"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// allowedTags is the structural-only allow list. Atom names match
// golang.org/x/net/html/atom but we use string compares for clarity.
var allowedTags = map[string]struct{}{
	"p": {}, "br": {}, "ul": {}, "ol": {}, "li": {},
	"h3": {}, "h4": {}, "h5": {},
	"strong": {}, "b": {}, "em": {}, "i": {}, "u": {},
	"a":    {},
	"span": {}, "div": {},
}

// dropEntirely contains tags whose CONTENT we also strip (not just the
// tag wrapper). Anything that could carry executable payload — even as
// bare text content — must vanish completely so the frontend's eventual
// dangerouslySetInnerHTML can't get tricked.
var dropEntirely = map[string]struct{}{
	"script": {}, "style": {}, "iframe": {}, "object": {}, "embed": {},
	"noscript": {}, "template": {},
}

// SanitizeHTML walks the input as an HTML fragment and returns a string
// containing only the allow-listed tags. Unknown tags are skipped but
// their text children are preserved. Attributes are stripped except
// href on <a> (which is also URL-scheme filtered).
func SanitizeHTML(in string) string {
	in = strings.TrimSpace(in)
	if in == "" {
		return ""
	}
	nodes, err := html.ParseFragment(strings.NewReader(in), &html.Node{
		Type:     html.ElementNode,
		Data:     "div",
		DataAtom: atom.Div,
	})
	if err != nil {
		// Anti-fallback: never silently lose content. If the parser
		// chokes, escape the raw text so it renders as literal text
		// rather than vanishing.
		return html.EscapeString(in)
	}
	var buf bytes.Buffer
	for _, n := range nodes {
		writeNode(&buf, n)
	}
	return strings.TrimSpace(buf.String())
}

func writeNode(buf *bytes.Buffer, n *html.Node) {
	switch n.Type {
	case html.TextNode:
		buf.WriteString(html.EscapeString(n.Data))
	case html.ElementNode:
		tag := strings.ToLower(n.Data)
		if _, drop := dropEntirely[tag]; drop {
			return
		}
		if _, ok := allowedTags[tag]; !ok {
			// Not allowed — drop the wrapper, recurse into children.
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				writeNode(buf, c)
			}
			return
		}
		buf.WriteByte('<')
		buf.WriteString(tag)
		// only <a href> survives, and only safe schemes
		if tag == "a" {
			for _, a := range n.Attr {
				if strings.ToLower(a.Key) == "href" && safeURL(a.Val) {
					buf.WriteString(` href="`)
					buf.WriteString(html.EscapeString(a.Val))
					buf.WriteString(`" target="_blank" rel="noopener noreferrer"`)
					break
				}
			}
		}
		// void elements
		if tag == "br" {
			buf.WriteString(" />")
			return
		}
		buf.WriteByte('>')
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			writeNode(buf, c)
		}
		buf.WriteString("</")
		buf.WriteString(tag)
		buf.WriteByte('>')
	case html.ErrorNode, html.DocumentNode, html.CommentNode, html.DoctypeNode, html.RawNode:
		// document, doctype, comment, raw — recurse children if present
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			writeNode(buf, c)
		}
	}
}

func safeURL(u string) bool {
	u = strings.TrimSpace(strings.ToLower(u))
	switch {
	case strings.HasPrefix(u, "http://"), strings.HasPrefix(u, "https://"),
		strings.HasPrefix(u, "mailto:"), strings.HasPrefix(u, "/"), strings.HasPrefix(u, "#"):
		return true
	}
	return false
}

// PlainTextLines splits HTML into bullet-friendly text lines. Used by
// fetchers that want to convert a single description blob into Duties /
// Requirements arrays (Yandex's duties field can be either HTML or a
// newline-delimited plain string). Returns trimmed non-empty entries.
func PlainTextLines(in string) []string {
	if strings.TrimSpace(in) == "" {
		return nil
	}
	// Strip tags by reusing the sanitiser but with an empty allow list
	// substitute: just run html.Parse and collect text nodes.
	nodes, err := html.ParseFragment(strings.NewReader(in), &html.Node{
		Type: html.ElementNode, Data: "div", DataAtom: atom.Div,
	})
	if err != nil {
		return splitLines(in)
	}
	var buf bytes.Buffer
	for _, n := range nodes {
		collectText(&buf, n)
	}
	return splitLines(buf.String())
}

func collectText(buf *bytes.Buffer, n *html.Node) {
	switch n.Type {
	case html.TextNode:
		buf.WriteString(n.Data)
	case html.ElementNode:
		tag := strings.ToLower(n.Data)
		if tag == "li" || tag == "p" || tag == "br" || tag == "h3" || tag == "h4" {
			buf.WriteByte('\n')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			collectText(buf, c)
		}
		if tag == "li" || tag == "p" || tag == "h3" || tag == "h4" {
			buf.WriteByte('\n')
		}
	case html.ErrorNode, html.DocumentNode, html.CommentNode, html.DoctypeNode, html.RawNode:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			collectText(buf, c)
		}
	}
}

func splitLines(s string) []string {
	out := []string{}
	for _, ln := range strings.Split(s, "\n") {
		ln = strings.TrimSpace(ln)
		// strip leading bullet glyphs
		ln = strings.TrimLeft(ln, "•-—* \t")
		ln = strings.TrimSpace(ln)
		if ln != "" {
			out = append(out, ln)
		}
	}
	return out
}
