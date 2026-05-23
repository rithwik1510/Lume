// PaneTree — recursive React component that renders a LayoutNode as nested
// react-resizable-panels groups. Leaves render TerminalPane. Splits render
// a PanelGroup with two Panels and a PanelResizeHandle in between.
//
// Splitter drag flow:
//   user drags handle
//     → react-resizable-panels fires onLayout([leftPct, rightPct])
//     → we compute ratio = leftPct/100
//     → call useLayoutStore.resizeSplit(firstLeafLeft, firstLeafRight, ratio)
//     → store applies via tree.resizeSplit (clamped); next render reads new ratio
//
// We feed react-resizable-panels both `defaultSize` (initial mount) AND let
// it become uncontrolled afterwards. Updating `defaultSize` via state would
// fight the user's drag — the tree IS the source of truth, but we only push
// it back via resizeSplit when the user drags, not on every render.

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";

import { TerminalPane } from "@/components/TerminalPane";
import { beginResize, endResize } from "@/components/resizeBus";
import { useLayoutStore } from "@/store/layoutStore";
import { leaves, type LayoutNode } from "@/store/layout/tree";

/**
 * Per-pane percentage limits during a splitter drag. Below the minimum
 * each pane gets too narrow for real shell output (wraps at <30 columns);
 * above the maximum the OTHER pane hits the same condition. 25/75 keeps
 * both panes comfortably usable across any reasonable window width —
 * tighter than the original 15/85 because squeezing a pane to 15% turns
 * out to be cramped enough that nobody actually wants to leave it there.
 */
const PANE_MIN_PCT = 25;
const PANE_MAX_PCT = 75;

interface Props {
  node: LayoutNode;
  /** Unique id within the tree — used as PanelGroup id for stable identity. */
  path: string;
}

function PaneTreeImpl({ node, path }: Props) {
  if (node.type === "leaf") {
    return <LeafFrame paneId={node.paneId} />;
  }
  return <SplitFrame node={node} path={path} />;
}

export const PaneTree = memo(PaneTreeImpl);

// ---------- Leaf rendering ----------

interface LeafFrameProps {
  paneId: string;
}

const LeafFrameImpl = ({ paneId }: LeafFrameProps) => {
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);
  const focused = focusedPaneId === paneId;
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        // Uniform thin border on every pane — focus is shown by the xterm
        // cursor (visible blink), not by a heavy frame. Splitters already
        // delineate panes from each other.
        border: "1px solid var(--border)",
        background: "var(--bg-0)",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 4,
          right: 8,
          fontSize: 10,
          // Subtle focus tell on the id badge — no full-pane chrome.
          color: focused ? "var(--fg-1)" : "var(--fg-2)",
          fontFamily: "Inter, sans-serif",
          userSelect: "none",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        {paneId}
      </div>
      <TerminalPane paneId={paneId} />
    </div>
  );
};
const LeafFrame = memo(LeafFrameImpl);

// ---------- Split rendering ----------

function SplitFrame({ node, path }: { node: LayoutNode; path: string }) {
  if (node.type !== "split") return null;

  const resizeSplit = useLayoutStore((s) => s.resizeSplit);
  const groupRef = useRef<ImperativePanelGroupHandle | null>(null);

  // Cache the first leaf on each side of the split. These are the two ids we
  // pass to resizeSplit so tree.ts can identify which split node to update.
  // Recomputed only when the subtree shape changes.
  const [leftAnchor, rightAnchor] = useMemo(() => {
    const l = leaves(node.left)[0];
    const r = leaves(node.right)[0];
    return [l, r] as const;
  }, [node]);

  // onLayout fires on every drag tick (~60/sec). If we update the Zustand
  // store on each tick, the whole PaneTree re-renders 60 times/sec — second-
  // order layout churn that contributes to the splitter-drag flicker.
  //
  // Strategy: debounce the store update to 120 ms after the drag settles.
  // react-resizable-panels owns the Panel sizes internally during the drag
  // (it's uncontrolled after mount). We only persist the final ratio.
  const debouncedStore = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (debouncedStore.current !== null) window.clearTimeout(debouncedStore.current);
    };
  }, []);

  const onLayout = useCallback(
    (sizes: number[]) => {
      if (debouncedStore.current !== null) window.clearTimeout(debouncedStore.current);
      debouncedStore.current = window.setTimeout(() => {
        debouncedStore.current = null;
        const left = sizes[0];
        if (left === undefined || leftAnchor === undefined || rightAnchor === undefined) return;
        const ratio = left / 100;
        // Skip near-no-ops to avoid feedback loops on settle.
        if (Math.abs(ratio - node.ratio) < 0.001) return;
        resizeSplit(leftAnchor, rightAnchor, ratio);
      }, 120);
    },
    [leftAnchor, rightAnchor, node.ratio, resizeSplit]
  );

  const direction =
    node.orientation === "horizontal" ? "horizontal" : "vertical";

  // Default sizes pulled from the tree once. After mount, the user drives sizes.
  const leftDefault = node.ratio * 100;
  const rightDefault = 100 - leftDefault;

  return (
    <PanelGroup
      direction={direction}
      onLayout={onLayout}
      autoSaveId={undefined}
      id={`pg-${path}`}
      ref={groupRef}
      style={{ width: "100%", height: "100%" }}
    >
      <Panel defaultSize={leftDefault} minSize={PANE_MIN_PCT} maxSize={PANE_MAX_PCT}>
        <PaneTree node={node.left} path={`${path}.L`} />
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          // Body-class toggle + per-pane fit deferral. See resizeBus.ts
          // header comment for the WebGL canvas-clear root cause.
          if (isDragging) beginResize();
          else endResize();
        }}
        style={{
          background: "var(--border)",
          ...(direction === "horizontal"
            ? { width: 3, cursor: "col-resize" }
            : { height: 3, cursor: "row-resize" }),
        }}
      />
      <Panel defaultSize={rightDefault} minSize={PANE_MIN_PCT} maxSize={PANE_MAX_PCT}>
        <PaneTree node={node.right} path={`${path}.R`} />
      </Panel>
    </PanelGroup>
  );
}
