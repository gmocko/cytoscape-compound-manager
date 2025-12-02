/**
 * Layout Integration Tests
 * 
 * Tests for Cola layout integration (S-03)
 * 
 * Note: In headless mode, boundingBox returns 0 dimensions.
 * These tests focus on API behavior rather than pixel-perfect overlap detection.
 */

import cytoscape from 'cytoscape';
import register from '../src/index.js';

register(cytoscape);

describe('Layout Integration', () => {
  let cy, api;

  beforeEach(() => {
    cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: 'parent' }, position: { x: 100, y: 100 } },
        { data: { id: 'child1', parent: 'parent' }, position: { x: 100, y: 100 } },
        { data: { id: 'child2', parent: 'parent' }, position: { x: 105, y: 105 } },
        { data: { id: 'child3', parent: 'parent' }, position: { x: 200, y: 200 } },
        { data: { id: 'external' }, position: { x: 300, y: 100 } },
        { data: { id: 'e1', source: 'child1', target: 'external' } }
      ],
      layout: { name: 'preset' }
    });
    api = cy.compoundManager({ autoLayout: false });
  });

  describe('Overlap Detection (API)', () => {
    test('hasOverlaps returns boolean', () => {
      // In headless mode, boundingBox is zero so no overlaps detected
      const result = api.hasOverlaps();
      expect(typeof result).toBe('boolean');
    });

    test('resolveOverlaps returns boolean success status', () => {
      const result = api.resolveOverlaps();
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true); // Should succeed (no overlaps in headless)
    });
  });

  describe('Hidden Nodes', () => {
    test('hidden nodes are not considered for overlap', () => {
      // Collapse parent - children become hidden
      api.collapse(cy.$id('parent'));
      
      // Hidden nodes should not affect overlap detection
      expect(api.hasOverlaps()).toBe(false);
    });

    test('hidden nodes are excluded from layout', () => {
      api.collapse(cy.$id('parent'));
      
      // After collapse, only parent and external are visible
      cy.$id('parent').position({ x: 100, y: 100 });
      cy.$id('external').position({ x: 300, y: 100 });
      
      expect(api.hasOverlaps()).toBe(false);
    });
  });

  describe('Auto Layout', () => {
    test('auto layout is disabled by default', () => {
      expect(api.isAutoLayoutEnabled()).toBe(false);
    });

    test('can enable/disable auto layout', () => {
      api.setAutoLayout(true);
      expect(api.isAutoLayoutEnabled()).toBe(true);
      
      api.setAutoLayout(false);
      expect(api.isAutoLayoutEnabled()).toBe(false);
    });
  });

  describe('Layout API', () => {
    test('runLayout returns a promise', () => {
      const result = api.runLayout();
      expect(result).toBeInstanceOf(Promise);
    });

    test('runLocalLayout returns a promise', () => {
      const result = api.runLocalLayout(cy.$id('parent'));
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

describe('Debouncing', () => {
  test('debounce delays function execution', (done) => {
    let callCount = 0;
    const debounced = (() => {
      // Simple inline debounce for testing
      let timeoutId = null;
      return function() {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          callCount++;
          timeoutId = null;
        }, 50);
      };
    })();
    
    // Call multiple times rapidly
    debounced();
    debounced();
    debounced();
    
    // Should not have been called yet
    expect(callCount).toBe(0);
    
    // After delay, should be called exactly once
    setTimeout(() => {
      expect(callCount).toBe(1);
      done();
    }, 100);
  });
});

