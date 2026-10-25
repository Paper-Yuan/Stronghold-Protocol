// 转场 helpers (PR #643): small hooks for the one-off motion of the room and the pre-game screens. With
// prefers-reduced-motion nothing plays. [ASSUMED] The motion and its timings (700 ms here, the room's 480 / 70 ms rise in
// css/screens/room.css) come from the community PR #643 design, not from a recording of the event.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { reducedMotion } from './device.js';

/**
 * True for `ms` after `value` turns truthy — not on the first render, so a seat already ready when the room opens (or a
 * pick already made when the draft opens) does not flash; never with reduced motion. screens/room.js (a seat turns
 * ready, an AI teammate is added), screens/bandDraft.js (a pick lands on an order row).
 * @param {any} value
 * @param {number} [ms]
 * @param {boolean} [fresh] the component mounts after its screen was already showing (a seat card that just appeared): a
 *   truthy `value` at the first render flashes too
 */
export function useRise(value, ms = 700, fresh = false) {
  const prev = useRef(fresh ? false : !!value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = !!value;
    if (!value) { setOn(false); return undefined; }
    if (was || reducedMotion()) return undefined;
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [!!value]);
  return on;
}

/**
 * Leave transition hook for modal/dialog close animations. Returns [leaving, leave] where:
 * - leaving: boolean state indicating if leave animation is playing
 * - leave: function to trigger the leave animation, calls onClose after animation completes
 * @param {() => void} onClose callback to invoke after leave animation completes
 * @param {number} [ms] animation duration in milliseconds
 * @returns {[boolean, () => void]}
 */
export function useLeave(onClose, ms = 300) {
  const [leaving, setLeaving] = useState(false);
  const leave = () => {
    if (reducedMotion()) {
      onClose();
      return;
    }
    setLeaving(true);
    setTimeout(onClose, ms);
  };
  return [leaving, leave];
}

/**
 * Presence transition hook for elements that appear/disappear based on a condition. Returns [shown, leaving] where:
 * - shown: boolean indicating if element should be rendered (true during entrance, display, and exit)
 * - leaving: boolean indicating if exit animation is playing
 * @param {boolean} condition when true, element is shown; when false, exit animation plays then element unmounts
 * @param {number} [ms] exit animation duration in milliseconds
 * @returns {[boolean, boolean]}
 */
export function usePresence(condition, ms = 300) {
  const [shown, setShown] = useState(condition);
  const [leaving, setLeaving] = useState(false);
  const timeoutRef = useRef(null);
  
  useEffect(() => {
    if (condition) {
      setShown(true);
      setLeaving(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else if (shown) {
      if (reducedMotion()) {
        setShown(false);
        setLeaving(false);
      } else {
        setLeaving(true);
        timeoutRef.current = setTimeout(() => {
          setShown(false);
          setLeaving(false);
          timeoutRef.current = null;
        }, ms);
      }
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [condition, shown, ms]);
  
  return [shown, leaving];
}
