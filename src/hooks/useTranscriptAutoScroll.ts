import React from 'react';

interface UseTranscriptAutoScrollOptions {
  meetingId?: string;
  itemCount: number;
  latestItemKey: string;
  active?: boolean;
  suspendAutoScroll?: boolean;
}

interface UseTranscriptAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  autoScrollEnabled: boolean;
  isNearBottom: boolean;
  unseenCount: number;
  showJumpToLatest: boolean;
  handleScroll: React.UIEventHandler<HTMLDivElement>;
  toggleAutoScroll: () => void;
  pauseAutoScroll: () => void;
  jumpToLatest: () => void;
}

const BOTTOM_SNAP_THRESHOLD_PX = 36;
const USER_SCROLL_UP_THRESHOLD_PX = 64;

function getPreferredBehavior(requested: ScrollBehavior): ScrollBehavior {
  if (
    requested === 'smooth' &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'auto';
  }
  return requested;
}

/**
 * Keeps a scrollable transcript container pinned to the latest speaker turn as
 * new transcript items arrive, while automatically pausing if the user scrolls
 * up to inspect earlier turns and offering a one-click jump back to latest.
 */
export function useTranscriptAutoScroll({
  meetingId,
  itemCount,
  latestItemKey,
  active = true,
  suspendAutoScroll = false,
}: UseTranscriptAutoScrollOptions): UseTranscriptAutoScrollResult {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true);
  const [isNearBottom, setIsNearBottom] = React.useState(true);
  const [unseenCount, setUnseenCount] = React.useState(0);

  const programmaticScrollUntilRef = React.useRef(0);
  const autoPausedByScrollRef = React.useRef(false);
  const prevCountRef = React.useRef(itemCount);
  const prevMeetingIdRef = React.useRef(meetingId);
  const prevActiveRef = React.useRef(active);
  const rafIdRef = React.useRef<number | null>(null);

  const scrollToBottom = React.useCallback((requestedBehavior: ScrollBehavior = 'smooth') => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = containerRef.current;
      if (!el) return;

      const behavior = getPreferredBehavior(requestedBehavior);
      programmaticScrollUntilRef.current = Date.now() + (behavior === 'smooth' ? 520 : 120);
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    });
  }, []);

  React.useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Reset tracking when switching meetings
  React.useEffect(() => {
    if (prevMeetingIdRef.current === meetingId) return;
    prevMeetingIdRef.current = meetingId;
    prevCountRef.current = itemCount;
    autoPausedByScrollRef.current = false;
    setAutoScrollEnabled(true);
    setIsNearBottom(true);
    setUnseenCount(0);
    if (active && itemCount > 0) {
      scrollToBottom('auto');
    }
  }, [meetingId, itemCount, active, scrollToBottom]);

  // Re-scroll to bottom when the transcript pane becomes visible again while auto-scroll is active
  React.useEffect(() => {
    const becameActive = active && !prevActiveRef.current;
    prevActiveRef.current = active;
    if (becameActive && autoScrollEnabled && !suspendAutoScroll && itemCount > 0) {
      setIsNearBottom(true);
      setUnseenCount(0);
      scrollToBottom('auto');
    }
  }, [active, autoScrollEnabled, suspendAutoScroll, itemCount, scrollToBottom]);

  // Respond to incoming transcript turns or updates to the latest turn
  React.useEffect(() => {
    const delta = itemCount - prevCountRef.current;
    prevCountRef.current = itemCount;

    if (itemCount === 0) {
      setUnseenCount(0);
      setIsNearBottom(true);
      return;
    }

    if (!active || suspendAutoScroll) {
      return;
    }

    if (autoScrollEnabled) {
      setUnseenCount(0);
      setIsNearBottom(true);
      scrollToBottom(delta > 3 ? 'auto' : 'smooth');
    } else if (delta > 0) {
      setUnseenCount((prev) => prev + delta);
    }
  }, [itemCount, latestItemKey, active, suspendAutoScroll, autoScrollEnabled, scrollToBottom]);

  const handleScroll: React.UIEventHandler<HTMLDivElement> = React.useCallback(
    (e) => {
      const el = e.currentTarget;
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

      if (distanceFromBottom <= BOTTOM_SNAP_THRESHOLD_PX) {
        setIsNearBottom(true);
        setUnseenCount(0);
        if (autoPausedByScrollRef.current) {
          autoPausedByScrollRef.current = false;
          setAutoScrollEnabled(true);
        }
        return;
      }

      if (Date.now() <= programmaticScrollUntilRef.current) {
        return;
      }

      if (distanceFromBottom > USER_SCROLL_UP_THRESHOLD_PX) {
        setIsNearBottom(false);
        if (autoScrollEnabled) {
          autoPausedByScrollRef.current = true;
          setAutoScrollEnabled(false);
        }
      }
    },
    [autoScrollEnabled],
  );

  const jumpToLatest = React.useCallback(() => {
    autoPausedByScrollRef.current = false;
    setAutoScrollEnabled(true);
    setIsNearBottom(true);
    setUnseenCount(0);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  const pauseAutoScroll = React.useCallback(() => {
    autoPausedByScrollRef.current = false;
    setAutoScrollEnabled(false);
  }, []);

  const toggleAutoScroll = React.useCallback(() => {
    if (autoScrollEnabled) {
      autoPausedByScrollRef.current = false;
      setAutoScrollEnabled(false);
    } else {
      jumpToLatest();
    }
  }, [autoScrollEnabled, jumpToLatest]);

  const showJumpToLatest = itemCount > 0 && (!isNearBottom || unseenCount > 0);

  return {
    containerRef,
    autoScrollEnabled,
    isNearBottom,
    unseenCount,
    showJumpToLatest,
    handleScroll,
    toggleAutoScroll,
    pauseAutoScroll,
    jumpToLatest,
  };
}
