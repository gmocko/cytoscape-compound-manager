/**
 * Cytoscape Compound Manager
 * 
 * Expand/collapse compound nodes with edge projection.
 * 
 * @module cytoscape-compound-manager
 */

import { createCore } from './core.js';

/**
 * Register the extension with Cytoscape.js
 * 
 * @param {Function} cytoscape - Cytoscape constructor
 */
let registered = false;

export default function register(cytoscape) {
  if (!cytoscape || registered) {
    return;
  }

  registered = true;
  
  cytoscape('core', 'compoundManager', function(options) {
    const cy = this;
    const opts = {
      animate: true,
      animationDuration: 300,
      ...options
    };

    return createCore(cy, opts);
  });
}

// Auto-register if cytoscape is available globally
if (typeof window !== 'undefined' && window.cytoscape) {
  register(window.cytoscape);
}
