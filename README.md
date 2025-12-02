# cytoscape-compound-manager

Expand/collapse compound nodes with edge projection for Cytoscape.js.

## Features

- ✅ Collapse/expand compound nodes
- ✅ Edge projection (aggregates child edges to parent)
- ✅ Position preservation after expand
- ✅ Cola/Cose layout integration
- ✅ Auto-layout after operations
- ✅ Overlap resolution

## Installation

```bash
npm install cytoscape-compound-manager
```

## Usage

```javascript
import cytoscape from 'cytoscape';
import cytoscapeCola from 'cytoscape-cola';
import compoundManager from 'cytoscape-compound-manager';

// Register extensions
cytoscape.use(cytoscapeCola);
compoundManager(cytoscape);

// Create graph
const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [...],
});

// Initialize compound manager
const api = cy.compoundManager({
  animate: true,
  autoLayout: true
});

// Collapse a node
api.collapse(cy.$id('parent'));

// Expand a node
api.expand(cy.$id('parent'));

// Collapse all
api.collapseAll();

// Expand all
api.expandAll();
```

## API

### Methods

| Method | Description |
|--------|-------------|
| `collapse(nodes)` | Collapse compound nodes |
| `expand(nodes)` | Expand compound nodes |
| `collapseAll()` | Collapse all compound nodes |
| `expandAll()` | Expand all compound nodes |
| `isCollapsed(node)` | Check if node is collapsed |
| `isHidden(ele)` | Check if element is hidden |
| `collapsedNodes()` | Get all collapsed nodes |
| `getProjectedEdges(node)` | Get projected edges for node |
| `runLayout()` | Run full layout |
| `runLocalLayout(node)` | Run local layout around node |
| `resolveOverlaps()` | Resolve overlapping nodes |
| `hasOverlaps()` | Check for overlaps |
| `setAutoLayout(bool)` | Enable/disable auto-layout |

### Events

- `compoundmanager.collapse` - Node collapsed
- `compoundmanager.expand` - Node expanded
- `compoundmanager.layoutResetRequired` - Layout needs reset

### CSS Classes

- `.cy-compound-collapsed` - Applied to collapsed nodes
- `.cy-compound-projection` - Applied to projection edges

## Demo

```bash
npm run demo
```

Open http://localhost:8080/demo/index.html

## License

MIT
