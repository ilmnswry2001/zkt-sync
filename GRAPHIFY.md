# Graphify navigation guide

`graphify-out/graph.json` is the local code/import graph; `GRAPH_TREE.html` is its interactive file and symbol browser. Use the graph to narrow source inspection, then confirm behavior, authorization, and database effects in source and migrations. Graph edges are hints and can include incomplete/dangling references.

## Focused workflow

From the repository root, find a symbol or file in `graphify-out/graph.json` or the tree, then run:

```powershell
graphify explain "<node or symbol>"
graphify affected "<node or symbol>" --depth 2
graphify path "<source node>" "<destination node>"
```

Use `explain` to inspect neighbors, `affected` to find reverse dependencies, and `path` to trace a connection between two known nodes. Keep the search focused on the requested feature; read only the resulting files and relevant tests/policies. Node labels can vary between graph generations.

## Refresh

After source changes, update the AST graph locally without an LLM, then regenerate the tree:

```powershell
graphify update . --no-cluster
graphify tree --graph graphify-out/graph.json --output graphify-out/GRAPH_TREE.html --root . --label "Smart Attendance Hub"
```

Graphify output is local and ignored by Git. Semantic extraction may infer extra links but needs a configured supported LLM API key; do not run it just for ordinary navigation. Inspect `graphify --help` for commands supported by the installed version; query syntax differs across Graphify versions.

## Limits

Graph structure does not prove runtime behavior, and generated links can be incomplete or dangling. Check current source, tests, Supabase RLS, and migrations before drawing conclusions. The current graph diagnostics report dangling endpoints; account for that when following paths.
