/**
 * Invariant Tests
 * 
 * These tests are written BEFORE implementation.
 * They verify the fundamental invariants from the specification.
 * 
 * @see docs/SPECIFICATION.md Section 4: Inwarianty
 */

import cytoscape from 'cytoscape';
import register from '../src/index.js';

// Register extension
register(cytoscape);

// ============================================
// TEST FIXTURES
// ============================================

/**
 * Create a simple test graph with compound nodes
 * 
 * Structure:
 *   parent1
 *   ├── child1 ──→ external1
 *   └── child2 ──→ external1
 *   
 *   parent2
 *   └── child3 ──→ child1 (cross-parent)
 */
function createTestGraph() {
  return cytoscape({
    headless: true,
    elements: [
      // Parents
      { data: { id: 'parent1' } },
      { data: { id: 'parent2' } },
      
      // Children of parent1
      { data: { id: 'child1', parent: 'parent1' } },
      { data: { id: 'child2', parent: 'parent1' } },
      
      // Children of parent2
      { data: { id: 'child3', parent: 'parent2' } },
      
      // External node
      { data: { id: 'external1' } },
      
      // Edges
      { data: { id: 'e1', source: 'child1', target: 'external1' } },
      { data: { id: 'e2', source: 'child2', target: 'external1' } },
      { data: { id: 'e3', source: 'child3', target: 'child1' } },
    ]
  });
}

/**
 * Create a deep nested graph (3 levels)
 * 
 * Structure:
 *   grandparent
 *   └── parent
 *       └── child ──→ external
 */
function createNestedGraph() {
  return cytoscape({
    headless: true,
    elements: [
      { data: { id: 'grandparent' } },
      { data: { id: 'parent', parent: 'grandparent' } },
      { data: { id: 'child', parent: 'parent' } },
      { data: { id: 'external' } },
      { data: { id: 'e1', source: 'child', target: 'external' } },
    ]
  });
}

// ============================================
// INVARIANT TESTS
// ============================================

describe('Specification Invariants', () => {
  
  /**
   * INV 4.1: Po minimalizacji całe poddrzewo staje się ukryte
   * 
   * @see SPECIFICATION.md 4.1
   */
  describe('INV-4.1: Collapse hides entire subtree', () => {
    
    test('children are hidden after collapse', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      const child1 = cy.$('#child1');
      const child2 = cy.$('#child2');
      
      // Before collapse - children not hidden
      expect(api.isHidden(child1)).toBe(false);
      expect(api.isHidden(child2)).toBe(false);
      
      // Collapse
      api.collapse(parent);
      
      // After collapse - children hidden
      expect(api.isHidden(child1)).toBe(true);
      expect(api.isHidden(child2)).toBe(true);
    });
    
    test('nested descendants are hidden (recursive)', () => {
      const cy = createNestedGraph();
      const api = cy.compoundManager();
      
      const grandparent = cy.$('#grandparent');
      const parent = cy.$('#parent');
      const child = cy.$('#child');
      
      // Collapse grandparent
      api.collapse(grandparent);
      
      // All descendants hidden
      expect(api.isHidden(parent)).toBe(true);
      expect(api.isHidden(child)).toBe(true);
    });
  });
  
  /**
   * INV 4.1: Po maksymalizacji całe poddrzewo pojawia się ponownie
   * 
   * @see SPECIFICATION.md 4.1
   */
  describe('INV-4.1: Expand shows subtree', () => {
    
    test('children are visible after expand', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      const child1 = cy.$('#child1');
      
      // Collapse then expand
      api.collapse(parent);
      api.expand(parent);
      
      // Children visible again
      expect(api.isHidden(child1)).toBe(false);
    });
    
    test('nested collapsed state is preserved', () => {
      const cy = createNestedGraph();
      const api = cy.compoundManager();
      
      const grandparent = cy.$('#grandparent');
      const parent = cy.$('#parent');
      const child = cy.$('#child');
      
      // Collapse inner parent first
      api.collapse(parent);
      
      // Then collapse grandparent
      api.collapse(grandparent);
      
      // Expand grandparent only
      api.expand(grandparent);
      
      // Parent visible but still collapsed, child still hidden
      expect(api.isHidden(parent)).toBe(false);
      expect(api.isCollapsed(parent)).toBe(true);
      expect(api.isHidden(child)).toBe(true);
    });
  });
  
  /**
   * INV 4.3: Projekcja agreguje wiele relacji do jednego celu w jedną krawędź
   * 
   * @see SPECIFICATION.md 4.3, 6.2
   */
  describe('INV-4.3: Projection aggregates to single edge', () => {
    
    test('multiple children edges to same target become one projection', () => {
      // Create a clean graph for this specific test
      const cy = cytoscape({
        headless: true,
        elements: [
          { data: { id: 'parent' } },
          { data: { id: 'child1', parent: 'parent' } },
          { data: { id: 'child2', parent: 'parent' } },
          { data: { id: 'external' } },
          // Two edges from different children to SAME external target
          { data: { id: 'e1', source: 'child1', target: 'external' } },
          { data: { id: 'e2', source: 'child2', target: 'external' } },
        ]
      });
      
      const api = cy.compoundManager();
      const parent = cy.$('#parent');
      
      // Before collapse: 2 edges to external
      const edgesBefore = cy.edges('[target = "external"]');
      expect(edgesBefore.length).toBe(2);
      
      // Collapse
      api.collapse(parent);
      
      // After collapse: 1 projection edge (aggregated)
      const projections = api.getProjectedEdges(parent);
      expect(projections.length).toBe(1);
      
      // Projection connects parent to external
      const proj = projections[0];
      expect(proj.source().id()).toBe('parent');
      expect(proj.target().id()).toBe('external');
    });
    
    test('original edges are hidden', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      const edge1 = cy.$('#e1');
      const edge2 = cy.$('#e2');
      
      api.collapse(parent);
      
      // Original edges hidden
      expect(api.isHidden(edge1)).toBe(true);
      expect(api.isHidden(edge2)).toBe(true);
    });
  });
  
  /**
   * INV 4.3: Relacje wewnętrzne poddrzewa nie są projektowane
   * 
   * @see SPECIFICATION.md 4.3, 6.4
   */
  describe('INV-4.3: Internal edges not projected', () => {
    
    test('edges between children of same parent are just hidden', () => {
      const cy = cytoscape({
        headless: true,
        elements: [
          { data: { id: 'parent' } },
          { data: { id: 'child1', parent: 'parent' } },
          { data: { id: 'child2', parent: 'parent' } },
          { data: { id: 'internal', source: 'child1', target: 'child2' } },
        ]
      });
      
      const api = cy.compoundManager();
      const parent = cy.$('#parent');
      
      api.collapse(parent);
      
      // No projections (internal edge)
      const projections = api.getProjectedEdges(parent);
      expect(projections.length).toBe(0);
      
      // Internal edge hidden
      expect(api.isHidden(cy.$('#internal'))).toBe(true);
    });
  });
  
  /**
   * INV 5.2: Po expand pozycje dzieci są przywracane
   * 
   * @see SPECIFICATION.md 5.2.2, 4.2
   */
  describe('INV-5.2: Positions restored after expand', () => {
    
    test('children return to approximately same positions', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      const child1 = cy.$('#child1');
      
      // Set known position
      child1.position({ x: 100, y: 200 });
      parent.position({ x: 50, y: 50 });
      
      const posBefore = { ...child1.position() };
      
      // Collapse and expand
      api.collapse(parent);
      api.expand(parent);
      
      // Position approximately same (within tolerance)
      const posAfter = child1.position();
      const dx = Math.abs(posAfter.x - posBefore.x);
      const dy = Math.abs(posAfter.y - posBefore.y);
      
      expect(dx).toBeLessThan(1);
      expect(dy).toBeLessThan(1);
    });
  });
  
  /**
   * State correctness
   */
  describe('State Management', () => {
    
    test('isCollapsed returns correct state', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      
      expect(api.isCollapsed(parent)).toBe(false);
      
      api.collapse(parent);
      expect(api.isCollapsed(parent)).toBe(true);
      
      api.expand(parent);
      expect(api.isCollapsed(parent)).toBe(false);
    });
    
    test('collapsedNodes returns all collapsed', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      api.collapse(cy.$('#parent1'));
      api.collapse(cy.$('#parent2'));
      
      const collapsed = api.collapsedNodes();
      expect(collapsed.length).toBe(2);
    });
    
    test('cannot collapse non-parent node', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const leaf = cy.$('#external1');
      api.collapse(leaf);
      
      expect(api.isCollapsed(leaf)).toBe(false);
    });
    
    test('cannot collapse already collapsed node', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      
      // First collapse succeeds
      api.collapse(parent);
      const projections1 = api.getProjectedEdges(parent);
      
      // Second collapse is no-op
      api.collapse(parent);
      const projections2 = api.getProjectedEdges(parent);
      
      // Same projections (no duplicates)
      expect(projections1.length).toBe(projections2.length);
    });
  });
  
  /**
   * CSS class correctness
   */
  describe('CSS Classes', () => {
    
    test('collapsed node has cy-compound-collapsed class', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      const parent = cy.$('#parent1');
      
      api.collapse(parent);
      // Re-select to get fresh reference
      const parentAfterCollapse = cy.$('#parent1');
      expect(parentAfterCollapse.hasClass('cy-compound-collapsed')).toBe(true);
      
      api.expand(parentAfterCollapse);
      const parentAfterExpand = cy.$('#parent1');
      expect(parentAfterExpand.hasClass('cy-compound-collapsed')).toBe(false);
    });
    
    test('projection edges have cy-compound-projection class', () => {
      const cy = createTestGraph();
      const api = cy.compoundManager();
      
      api.collapse(cy.$('#parent1'));
      
      const projections = api.getProjectedEdges(cy.$('#parent1'));
      projections.forEach(proj => {
        expect(proj.hasClass('cy-compound-projection')).toBe(true);
      });
    });
  });
});
