// public/js/ui/VirtualModList.js — Virtual scrolling for mod list (performance optimization)
import { html } from './components.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';

const ITEM_HEIGHT = 120; // 每个模组卡片的高度（px）
const BUFFER_SIZE = 3; // 上下各缓冲 3 个元素

/**
 * Virtual scrolling list component for large mod collections.
 * Only renders visible items + buffer to optimize performance.
 * 
 * @param {Object} props
 * @param {Array} props.items - Full list of mods
 * @param {Function} props.renderItem - Render function for each item
 * @param {number} [props.height=600] - Container height
 * @param {number} [props.itemHeight=120] - Height of each item
 */
export function VirtualModList({ items, renderItem, height = 600, itemHeight = ITEM_HEIGHT }) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef(null);
  
  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - BUFFER_SIZE);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / itemHeight) + BUFFER_SIZE
  );
  
  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;
  
  const handleScroll = (e) => {
    setScrollTop(e.target.scrollTop);
  };
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);
  
  return html`
    <div 
      ref=${containerRef}
      class="virtual-mod-list"
      style=${{
        height: `${height}px`,
        overflowY: 'auto',
        position: 'relative'
      }}
    >
      <div style=${{ height: `${totalHeight}px`, position: 'relative' }}>
        <div style=${{ transform: `translateY(${offsetY}px)` }}>
          ${visibleItems.map((item, index) => {
            const actualIndex = startIndex + index;
            return html`
              <div 
                key=${item.id || actualIndex}
                style=${{ height: `${itemHeight}px` }}
              >
                ${renderItem(item, actualIndex)}
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}
