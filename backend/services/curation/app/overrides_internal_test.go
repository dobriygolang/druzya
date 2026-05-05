package app

import (
	"strings"
	"testing"
)

func TestJsonString_EscapesQuotes(t *testing.T) {
	got := jsonString(`he said "hi"`)
	if !strings.Contains(got, `\"hi\"`) {
		t.Errorf("quote not escaped: %s", got)
	}
}
