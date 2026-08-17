import type { ReactNode } from 'react'
import type { MapLayout } from './layout.ts'
import css from './MmapView.module.css'

/** Owner props of the pure SVG map picture. */
export interface MapSvgProps {
  /** Computed picture for the active map at the current content step. */
  readonly layout: MapLayout
  /** Continuous display scale the geometry is multiplied by. */
  readonly scale: number
  /** Spotlit node id (hover wins over the pinned selection), if any. */
  readonly focus: string | null
  /** Pinned node id, ring-marked. */
  readonly selected: string | null
  /** Pointer entered / left a node. */
  readonly onHover: (id: string | null) => void
  /** Select or unselect (null on empty-space click) a node. */
  readonly onSelect: (id: string | null) => void
  /** Double-click on a node (dives into its submap when it links one). */
  readonly onDive: (id: string) => void
}

/**
 * Draw one computed layout as a layered SVG: lane headers, band rules with
 * names (and far-zoom member counts), status-skinned node boxes with their
 * unfolded detail lines and ⊞ submap badges, and downward orthogonal wires
 * routed with the terminal pane's preference — straight drops, packed track
 * runs, threaded descents — labels riding the primary run. The skins port the terminal
 * pane's border weights: the heavy square ┏━┓ of done/regressed becomes a
 * sharp 2px corner, the dashed rounded ╭╌╮ of planned stays soft.
 * The focused node's box and every wire touching it render bright. Pure
 * function of props — selection and hover live with the caller.
 */
export function MapSvg({ layout, scale, focus, selected, onHover, onSelect, onDive }: MapSvgProps): ReactNode {
  return (
    <svg
      className={css.map}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width * scale}
      height={layout.height * scale}
      role="img"
      onClick={() => { onSelect(null) }}
    >
      {layout.lanes.map(lane => (
        <g key={`lane:${lane.x}`} className={css.lane}>
          <text x={lane.x + lane.w / 2} y={14} textAnchor="middle">{lane.label}</text>
          <line x1={lane.x + lane.w / 2} y1={20} x2={lane.x + lane.w / 2} y2={layout.height} />
        </g>
      ))}
      {layout.bands.map(band => (
        <g key={`${band.name}:${band.y}`} className={css.band}>
          <line x1={0} y1={band.y} x2={layout.width} y2={band.y} />
          <text x={8} y={band.y - 5}>{band.counts !== undefined ? `${band.name} ${band.counts}` : band.name}</text>
        </g>
      ))}
      {/* The arrowhead inherits each wire's own stroke via context-stroke. */}
      <defs>
        <marker
          id="mmap-arrow"
          viewBox="0 0 8 8"
          refX="6.5"
          refY="4"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" stroke="none" />
        </marker>
      </defs>
      {layout.edges.map(edge => (
        <g
          key={`${edge.from}->${edge.to}`}
          className={css.edge}
          data-active={focus === edge.from || focus === edge.to ? 'true' : undefined}
        >
          <path
            d={edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]} ${point[1]}`).join(' ')}
            markerEnd="url(#mmap-arrow)"
          />
          {edge.label !== undefined ? (
            <text x={edge.labelX} y={edge.labelY}>{edge.label}</text>
          ) : null}
        </g>
      ))}
      {layout.boxes.map(box => (
        /* Position rides the group transform and size rides the rect, both
           CSS-transitionable — a threshold reflow glides boxes into the new
           layout instead of teleporting the whole picture in one frame. */
        <g
          key={box.node.id as string}
          className={css.node}
          transform={`translate(${box.x} ${box.y})`}
          data-status={layout.neutral ? 'neutral' : box.node.status}
          data-selected={selected === (box.node.id as string) ? 'true' : undefined}
          data-focused={focus === (box.node.id as string) ? 'true' : undefined}
          onPointerEnter={() => { onHover(box.node.id as string) }}
          onPointerLeave={() => { onHover(null) }}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(box.node.id as string)
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onDive(box.node.id as string)
          }}
        >
          <rect
            x={0}
            y={0}
            width={box.w}
            height={box.h}
            rx={!layout.neutral && (box.node.status === 'done' || box.node.status === 'regressed') ? 0 : 6}
          />
          {box.lines.map((line, index) => (
            <text
              key={`${line.role}:${index}`}
              className={css.boxLine}
              data-role={line.role}
              x={line.role === 'label' ? box.w / 2 : 10}
              y={12 + index * 17 + (line.role === 'label' ? 3 : 2)}
              textAnchor={line.role === 'label' ? 'middle' : 'start'}
            >
              {line.text}
            </text>
          ))}
          {box.node.submap !== undefined ? (
            <text className={css.submapBadge} x={box.w - 10} y={13}>⊞</text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
