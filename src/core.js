/**
 * Core logic for compound manager
 * 
 * KISS: All logic in one file. Extract only if > 400 lines.
 */

// ============================================
// UTILITIES
// ============================================

/**
 * Simple debounce function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {Function} Debounced function
 */
function debounce(fn, delay) {
  let timeoutId = null;
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

// ============================================
// STATE (per-instance using Maps keyed by cy id)
// ============================================

// State is stored per-cy instance to avoid test pollution
const instanceStates = new WeakMap();

function getState(cy) {
  if (!instanceStates.has(cy)) {
    instanceStates.set(cy, {
      collapsedIds: new Set(),
      hiddenElementsMap: new Map(),
      savedPositionsMap: new Map(),
      projectionEdgesMap: new Map(),
      hiddenIds: new Set()
    });
  }
  return instanceStates.get(cy);
}

// ============================================
// VISIBILITY HELPERS (work in headless mode)
// ============================================

function hideElement(cy, ele) {
  const state = getState(cy);
  ele.data('_hidden', true);
  state.hiddenIds.add(ele.id());
  // Also set style for browser mode
  ele.style('display', 'none');
}

function showElement(cy, ele) {
  const state = getState(cy);
  ele.removeData('_hidden');
  state.hiddenIds.delete(ele.id());
  // Also set style for browser mode
  ele.style('display', 'element');
}

function isHiddenEle(cy, ele) {
  const state = getState(cy);
  return state.hiddenIds.has(ele.id()) || ele.data('_hidden') === true;
}

// ============================================
// COLLAPSE / EXPAND
// ============================================

/**
 * Collapse a compound node
 * 
 * Invariant: After collapse, entire subtree is hidden
 */
function collapse(cy, node, opts) {
  const state = getState(cy);
  const nodeId = node.id();
  
  if (!node.isParent()) return false;
  if (state.collapsedIds.has(nodeId)) return false;

  const descendants = node.descendants();
  
  // Save positions before hiding (per spec 5.2.2)
  saveLocalPositions(cy, node, descendants);
  
  // Hide descendants
  const descendantIds = [];
  descendants.forEach(d => {
    hideElement(cy, d);
    descendantIds.push(d.id());
  });
  
  // Also hide edges connected to descendants
  descendants.connectedEdges().forEach(edge => {
    hideElement(cy, edge);
  });
  
  state.hiddenElementsMap.set(nodeId, descendantIds);
  
  // Create projections (per spec 5.1.4)
  createProjections(cy, node, descendants);
  
  // Mark as collapsed
  state.collapsedIds.add(nodeId);
  node.addClass('cy-compound-collapsed');
  
  // Emit event
  cy.emit('compoundmanager.collapse', { node });
  
  return true;
}

/**
 * Expand a collapsed node
 * 
 * Invariant: After expand, children return to approximately same positions
 */
function expand(cy, node, opts) {
  const state = getState(cy);
  const nodeId = node.id();
  
  if (!state.collapsedIds.has(nodeId)) return false;

  const descendantIds = state.hiddenElementsMap.get(nodeId) || [];
  
  // Show descendants (but not nested collapsed children)
  descendantIds.forEach(id => {
    const ele = cy.$id(id);
    if (ele.nonempty()) {
      const parent = ele.parent();
      // Only show if parent is this node or parent is not collapsed
      if (parent.empty() || parent.id() === nodeId || !state.collapsedIds.has(parent.id())) {
        showElement(cy, ele);
        
        // Also show edges if both endpoints are now visible
        ele.connectedEdges().forEach(edge => {
          const src = edge.source();
          const tgt = edge.target();
          if (!isHiddenEle(cy, src) && !isHiddenEle(cy, tgt) && !edge.data('_isProjection')) {
            showElement(cy, edge);
          }
        });
      }
    }
  });
  
  // Remove projections
  removeProjections(cy, node);
  
  // Restore positions (per spec 5.2.2)
  restoreLocalPositions(cy, node, opts);
  
  // Mark as expanded
  state.collapsedIds.delete(nodeId);
  state.hiddenElementsMap.delete(nodeId);
  node.removeClass('cy-compound-collapsed');
  
  // Emit event
  cy.emit('compoundmanager.expand', { node });
  
  return true;
}

/**
 * Check if node is collapsed
 */
function isCollapsedNode(cy, node) {
  const state = getState(cy);
  return state.collapsedIds.has(node.id());
}

// ============================================
// POSITION MANAGEMENT
// ============================================

/**
 * Save local positions relative to parent
 * 
 * Per spec 3.1: Local position (lx, ly) relative to parent
 */
function saveLocalPositions(cy, parent, descendants) {
  const state = getState(cy);
  const parentPos = parent.position();
  const positions = new Map();
  
  descendants.forEach(child => {
    const childPos = child.position();
    positions.set(child.id(), {
      lx: childPos.x - parentPos.x,
      ly: childPos.y - parentPos.y
    });
  });
  
  state.savedPositionsMap.set(parent.id(), positions);
}

/**
 * Restore local positions after expand
 * 
 * Per spec 5.2.2: Children receive their saved local positions
 */
function restoreLocalPositions(cy, parent, opts) {
  const state = getState(cy);
  const positions = state.savedPositionsMap.get(parent.id());
  if (!positions) return;
  
  const parentPos = parent.position();
  
  parent.children().forEach(child => {
    const localPos = positions.get(child.id());
    if (localPos) {
      const newPos = {
        x: parentPos.x + localPos.lx,
        y: parentPos.y + localPos.ly
      };
      
      if (opts && opts.animate) {
        child.animate({ position: newPos, duration: opts.animationDuration || 300 });
      } else {
        child.position(newPos);
      }
    }
  });
  
  state.savedPositionsMap.delete(parent.id());
}

// ============================================
// EDGE PROJECTION
// ============================================

/**
 * Create projected edges for collapsed node
 * 
 * Per spec 6.1: c → X becomes P → X
 * Per spec 6.2: Multiple edges aggregated to one
 */
function createProjections(cy, parent, descendants) {
  const parentId = parent.id();
  const descendantIds = new Set(descendants.map(n => n.id()));
  descendantIds.add(parentId);
  
  // Find external edges and internal edges
  const externalEdges = [];
  const internalEdges = [];
  const seenEdges = new Set();
  
  descendants.forEach(node => {
    node.connectedEdges().forEach(edge => {
      if (seenEdges.has(edge.id())) return;
      seenEdges.add(edge.id());
      
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      const sourceIn = descendantIds.has(sourceId);
      const targetIn = descendantIds.has(targetId);
      
      if (sourceIn && targetIn) {
        // Internal edge - both endpoints in subtree
        internalEdges.push(edge);
      } else if (sourceIn !== targetIn) {
        // External edge - exactly one endpoint in descendants
        externalEdges.push(edge);
      }
    });
  });
  
  // Hide internal edges (per spec 6.4 - not projected, just hidden)
  internalEdges.forEach(edge => {
    hideElement(cy, edge);
  });
  
  // Group by (direction, external node ID) for aggregation per spec 6.2
  // Multiple edges to same external target become ONE projection
  const groups = new Map();
  externalEdges.forEach(edge => {
    const sourceId = edge.source().id();
    const targetId = edge.target().id();
    
    // Determine direction and external node
    let key;
    if (descendantIds.has(sourceId) && !descendantIds.has(targetId)) {
      // Outgoing edge: child → external
      key = `out:${targetId}`;
    } else if (!descendantIds.has(sourceId) && descendantIds.has(targetId)) {
      // Incoming edge: external → child
      key = `in:${sourceId}`;
    } else {
      return; // Skip if both or neither in descendants
    }
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(edge);
  });
  
  // Create one projection per external target
  const projIds = [];
  let projCounter = 0;
  
  groups.forEach((edges, key) => {
    const [direction, externalId] = key.split(':');
    const projId = `_proj_${parentId}_${projCounter++}`;
    
    const source = direction === 'out' ? parentId : externalId;
    const target = direction === 'out' ? externalId : parentId;
    
    const proj = cy.add({
      group: 'edges',
      data: { id: projId, source, target, _isProjection: true }
    });
    
    proj.addClass('cy-compound-projection');
    projIds.push(projId);
  });
  
  // Store mapping
  const state = getState(cy);
  const originalIds = externalEdges.map(e => e.id());
  state.projectionEdgesMap.set(parentId, { projIds, originalIds });
}

/**
 * Remove projections and restore original edges
 * 
 * Per spec 5.2.4: Original edges are restored
 * Per spec 5.2.5: Projections are removed
 */
function removeProjections(cy, parent) {
  const state = getState(cy);
  const data = state.projectionEdgesMap.get(parent.id());
  if (!data) return;
  
  // Remove projection edges
  data.projIds.forEach(projId => {
    const proj = cy.$id(projId);
    if (proj.nonempty()) {
      cy.remove(proj);
    }
  });
  
  // Note: original edges are shown in expand() when both endpoints become visible
  
  state.projectionEdgesMap.delete(parent.id());
}

// ============================================
// LAYOUT INTEGRATION (Cola)
// ============================================

/**
 * Get visible nodes (not hidden by collapse)
 * @param {Core} cy - Cytoscape instance
 * @returns {Collection} Visible nodes
 */
function getVisibleNodes(cy) {
  return cy.nodes().filter(n => !isHiddenEle(cy, n));
}

/**
 * Check if two bounding boxes overlap
 * @param {Object} bb1 - First bounding box {x1, y1, x2, y2}
 * @param {Object} bb2 - Second bounding box {x1, y1, x2, y2}
 * @returns {boolean}
 */
function boxesOverlap(bb1, bb2) {
  return !(bb1.x2 < bb2.x1 || bb1.x1 > bb2.x2 || bb1.y2 < bb2.y1 || bb1.y1 > bb2.y2);
}

/**
 * Calculate overlap between two nodes
 * @param {NodeSingular} n1 
 * @param {NodeSingular} n2 
 * @returns {Object|null} Overlap info or null if no overlap
 */
function calculateOverlap(n1, n2) {
  const bb1 = n1.boundingBox();
  const bb2 = n2.boundingBox();
  
  if (!boxesOverlap(bb1, bb2)) return null;
  
  // Calculate overlap amount
  const overlapX = Math.min(bb1.x2, bb2.x2) - Math.max(bb1.x1, bb2.x1);
  const overlapY = Math.min(bb1.y2, bb2.y2) - Math.max(bb1.y1, bb2.y1);
  
  // Calculate direction to separate
  const dx = (bb1.x1 + bb1.x2) / 2 - (bb2.x1 + bb2.x2) / 2;
  const dy = (bb1.y1 + bb1.y2) / 2 - (bb2.y1 + bb2.y2) / 2;
  
  return { overlapX, overlapY, dx, dy };
}

/**
 * Separate two overlapping nodes
 * @param {NodeSingular} n1 
 * @param {NodeSingular} n2 
 * @param {Object} overlap - Overlap info from calculateOverlap
 * @param {number} padding - Minimum padding between nodes
 */
function separateNodes(n1, n2, overlap, padding = 10) {
  const { overlapX, overlapY, dx, dy } = overlap;
  
  // Move in the direction of least overlap
  let moveX = 0, moveY = 0;
  
  if (overlapX < overlapY) {
    // Separate horizontally
    moveX = (overlapX / 2 + padding) * (dx >= 0 ? 1 : -1);
  } else {
    // Separate vertically
    moveY = (overlapY / 2 + padding) * (dy >= 0 ? 1 : -1);
  }
  
  // Move both nodes half the distance each
  const pos1 = n1.position();
  const pos2 = n2.position();
  
  n1.position({ x: pos1.x + moveX, y: pos1.y + moveY });
  n2.position({ x: pos2.x - moveX, y: pos2.y - moveY });
}

/**
 * Check if any visible nodes overlap
 * @param {Core} cy - Cytoscape instance
 * @returns {boolean}
 */
function hasOverlaps(cy) {
  const visibleNodes = getVisibleNodes(cy).filter(n => !n.isParent());
  const nodes = visibleNodes.toArray();
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // Skip if one is ancestor of another
      if (nodes[i].ancestors().has(nodes[j]) || nodes[j].ancestors().has(nodes[i])) continue;
      
      if (calculateOverlap(nodes[i], nodes[j])) return true;
    }
  }
  return false;
}

/**
 * Resolve overlaps between visible nodes
 * Per spec 4.2: No overlaps between visible nodes
 * 
 * @param {Core} cy - Cytoscape instance
 * @param {Object} opts - Options
 * @returns {boolean} True if all overlaps resolved
 */
function resolveOverlaps(cy, opts = {}) {
  const maxIterations = opts.maxIterations || 50;
  const padding = opts.overlapPadding || 10;
  
  let iterations = 0;
  let hasOverlap = true;
  
  while (hasOverlap && iterations < maxIterations) {
    hasOverlap = false;
    iterations++;
    
    const visibleNodes = getVisibleNodes(cy).filter(n => !n.isParent());
    const nodes = visibleNodes.toArray();
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        // Skip if one is ancestor of another (compound parent-child)
        if (nodes[i].ancestors().has(nodes[j]) || nodes[j].ancestors().has(nodes[i])) continue;
        
        const overlap = calculateOverlap(nodes[i], nodes[j]);
        if (overlap) {
          separateNodes(nodes[i], nodes[j], overlap, padding);
          hasOverlap = true;
        }
      }
    }
  }
  
  // If we hit max iterations, emit warning event (per spec 7.3)
  if (iterations >= maxIterations && hasOverlaps(cy)) {
    cy.emit('compoundmanager.layoutResetRequired', {
      message: 'Layout wymaga ponownego przeliczenia',
      reason: 'overlap_resolution_failed'
    });
    return false;
  }
  
  return true;
}

/**
 * Check if Cola layout is available
 * @param {Core} cy - Cytoscape instance
 * @returns {boolean}
 */
function isColaAvailable(cy) {
  try {
    // Try to create layout options - will throw if not available
    return cy.layout({ name: 'cola', eles: cy.collection() }).options !== undefined;
  } catch {
    return false;
  }
}

/**
 * Run Cola layout on visible nodes only
 * Per spec 5.1.2: Hidden children don't participate in layout
 * 
 * @param {Core} cy - Cytoscape instance
 * @param {Object} opts - Layout options
 * @returns {Promise} Layout promise
 */
function runLayout(cy, opts = {}) {
  const visibleNodes = getVisibleNodes(cy);
  
  // Use cola if available, otherwise fall back to cose
  const layoutName = opts.layoutName || (isColaAvailable(cy) ? 'cola' : 'cose');
  
  // Build layout options respecting collapsed state
  const layoutOptions = {
    name: layoutName,
    animate: opts.animate !== false,
    animationDuration: opts.animationDuration || 300,
    fit: opts.fit !== false,
    padding: opts.padding || 30,
    nodeDimensionsIncludeLabels: true,
    // Only layout visible nodes
    eles: visibleNodes.union(visibleNodes.edgesWith(visibleNodes)),
    // Cola-specific options (ignored by cose)
    nodeSpacing: opts.nodeSpacing || 20,
    edgeLength: opts.edgeLength || 100,
    ...opts.colaOptions
  };
  
  return new Promise((resolve) => {
    const layout = cy.layout(layoutOptions);
    layout.on('layoutstop', () => {
      // Resolve any remaining overlaps
      resolveOverlaps(cy, opts);
      resolve();
    });
    layout.run();
  });
}

/**
 * Run local layout around a specific node
 * Per spec 5.2.3: Local layout adjustments after expand
 * Per spec 7.4: Locality of movement
 * 
 * @param {Core} cy - Cytoscape instance
 * @param {NodeSingular} node - Center node for local layout
 * @param {Object} opts - Layout options
 * @returns {Promise}
 */
function runLocalLayout(cy, node, opts = {}) {
  // Get nodes in neighborhood (1-2 hops)
  const neighborhood = node.neighborhood().nodes().filter(n => !isHiddenEle(cy, n));
  let affectedNodes = node.union(neighborhood);
  
  // Add children if expanded
  if (node.isParent()) {
    const visibleChildren = node.children().filter(n => !isHiddenEle(cy, n));
    affectedNodes = affectedNodes.union(visibleChildren);
  }
  
  if (affectedNodes.length < 2) {
    // Just resolve overlaps, no layout needed
    resolveOverlaps(cy, opts);
    return Promise.resolve();
  }
  
  // Store original positions of unaffected nodes
  const unaffectedNodes = getVisibleNodes(cy).difference(affectedNodes);
  const originalPositions = new Map();
  unaffectedNodes.forEach(n => {
    originalPositions.set(n.id(), { ...n.position() });
  });
  
  // Use cola if available, otherwise fall back to cose
  const layoutName = opts.layoutName || (isColaAvailable(cy) ? 'cola' : 'cose');
  
  const layoutOptions = {
    name: layoutName,
    animate: opts.animate !== false,
    animationDuration: opts.animationDuration || 200,
    fit: false, // Don't fit for local layout
    eles: affectedNodes.union(affectedNodes.edgesWith(affectedNodes)),
    nodeSpacing: opts.nodeSpacing || 15,
    ...opts.colaOptions
  };
  
  return new Promise((resolve) => {
    const layout = cy.layout(layoutOptions);
    layout.on('layoutstop', () => {
      // Restore positions of unaffected nodes (locality)
      unaffectedNodes.forEach(n => {
        const pos = originalPositions.get(n.id());
        if (pos) n.position(pos);
      });
      
      // Resolve any remaining overlaps
      resolveOverlaps(cy, opts);
      resolve();
    });
    layout.run();
  });
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Create the compound manager API
 */
export function createCore(cy, opts) {
  // Create debounced layout function (per spec 8.4)
  const debouncedLayout = debounce((node) => {
    if (node) {
      runLocalLayout(cy, node, opts);
    } else {
      runLayout(cy, opts);
    }
  }, opts.layoutDebounce || 100);
  
  // Track if auto-layout is enabled (default: false to avoid issues without Cola)
  let autoLayout = opts.autoLayout === true;
  
  return {
    /**
     * Collapse nodes
     * @param {Collection} nodes - Nodes to collapse
     */
    collapse(nodes) {
      const nodeList = nodes.toArray ? nodes.toArray() : [nodes];
      nodeList.forEach(node => {
        const collapsed = collapse(cy, node, opts);
        if (collapsed && autoLayout) {
          debouncedLayout(node);
        }
      });
      return this;
    },
    
    /**
     * Expand nodes
     * @param {Collection} nodes - Nodes to expand
     */
    expand(nodes) {
      const nodeList = nodes.toArray ? nodes.toArray() : [nodes];
      nodeList.forEach(node => {
        const expanded = expand(cy, node, opts);
        if (expanded && autoLayout) {
          debouncedLayout(node);
        }
      });
      return this;
    },
    
    /**
     * Check if node is collapsed
     * @param {NodeSingular} node
     * @returns {boolean}
     */
    isCollapsed(node) {
      return isCollapsedNode(cy, node);
    },
    
    /**
     * Check if element is hidden
     * @param {NodeSingular|EdgeSingular} ele
     * @returns {boolean}
     */
    isHidden(ele) {
      return isHiddenEle(cy, ele);
    },
    
    /**
     * Collapse all compound nodes (bottom-up: leaves first)
     */
    collapseAll() {
      // Sort by depth (deepest first) to collapse leaves before parents
      const compounds = cy.nodes().filter(n => n.isParent()).toArray();
      compounds.sort((a, b) => {
        const depthA = a.ancestors().length;
        const depthB = b.ancestors().length;
        return depthB - depthA; // Deeper nodes first
      });
      compounds.forEach(n => collapse(cy, n, opts));
      return this;
    },
    
    /**
     * Expand all collapsed nodes
     */
    expandAll() {
      cy.nodes().filter(n => isCollapsedNode(cy, n)).forEach(n => expand(cy, n, opts));
      return this;
    },
    
    /**
     * Get all collapsed nodes
     * @returns {Collection}
     */
    collapsedNodes() {
      return cy.nodes().filter(n => isCollapsedNode(cy, n));
    },
    
    /**
     * Get projected edges for a collapsed node
     * @param {NodeSingular} node
     * @returns {Array}
     */
    getProjectedEdges(node) {
      const state = getState(cy);
      const data = state.projectionEdgesMap.get(node.id());
      if (!data) return [];
      return data.projIds.map(id => cy.$id(id)).filter(e => e.nonempty());
    },
    
    // ============================================
    // LAYOUT API
    // ============================================
    
    /**
     * Run full Cola layout on visible nodes
     * Per spec 5.1.2: Hidden children don't participate
     * @returns {Promise}
     */
    runLayout() {
      return runLayout(cy, opts);
    },
    
    /**
     * Run local layout around a specific node
     * Per spec 5.2.3: Local layout adjustments
     * @param {NodeSingular} node - Center node
     * @returns {Promise}
     */
    runLocalLayout(node) {
      return runLocalLayout(cy, node, opts);
    },
    
    /**
     * Resolve any overlapping nodes
     * Per spec 4.2: No overlaps between visible nodes
     * @returns {boolean} True if all overlaps resolved
     */
    resolveOverlaps() {
      return resolveOverlaps(cy, opts);
    },
    
    /**
     * Check if any visible nodes overlap
     * @returns {boolean}
     */
    hasOverlaps() {
      return hasOverlaps(cy);
    },
    
    /**
     * Enable/disable automatic layout after collapse/expand
     * @param {boolean} enabled
     */
    setAutoLayout(enabled) {
      autoLayout = enabled;
      return this;
    },
    
    /**
     * Check if auto-layout is enabled
     * @returns {boolean}
     */
    isAutoLayoutEnabled() {
      return autoLayout;
    }
  };
}
