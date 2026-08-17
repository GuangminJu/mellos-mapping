import type { ReactNode } from 'react'
import type { MellosMap } from 'mellos-mapping/domain/types'
import { type NeighborRef, focusInfo, isNeutralKind } from 'mellos-mapping/semantics'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MmapView.module.css'

/** Owner props of the resident detail panel below the map. */
export interface DetailPanelProps {
  readonly map: MellosMap
  /** Focused node/group id (hover wins over pin), `null` for the dashboard. */
  readonly focus: string | null
  /** Whether the focus is the pinned selection (vs a transient hover). */
  readonly pinned: boolean
  readonly t: TranslateNS<'mmap'>
}

/** One neighbour chip: status-colored dot, label, and what flows on the edge. */
function NeighborChip({ neighbor }: { readonly neighbor: NeighborRef }): ReactNode {
  return (
    <span className={css.chip} data-status={neighbor.status}>
      {neighbor.label}
      {neighbor.edgeLabel !== undefined ? <em>({neighbor.edgeLabel})</em> : null}
    </span>
  )
}

/** A `word → chips` wire-direction row. */
function WireRow({ word, refs, t }: {
  readonly word: string
  readonly refs: readonly NeighborRef[]
  readonly t: DetailPanelProps['t']
}): ReactNode {
  return (
    <p className={css.wireRow}>
      <span className={css.detailKey}>{word}</span>
      {refs.length === 0 ? t('none') : refs.map(r => <NeighborChip key={r.id} neighbor={r} />)}
    </p>
  )
}

/**
 * The resident three-state panel the terminal pane keeps below the map:
 * a focused node (status header, evidence, both wire directions, notes), a
 * focused group (members plus outside-the-group wires), or — with nothing
 * focused — the map dashboard. Never floats over the map.
 */
export function DetailPanel({ map, focus, pinned, t }: DetailPanelProps): ReactNode {
  const info = focus === null ? undefined : focusInfo(map, focus)
  const neutral = isNeutralKind(map)
  const [usesWord, usedByWord] = map.kind === 'sequence' ? [t('after'), t('before')] : [t('uses'), t('usedBy')]

  if (info === undefined) {
    const count = (status: string): number => map.nodes.filter(n => n.status === status).length
    const parts = [
      `${map.layers.length} ${t('unit.layers')}`,
      `${map.nodes.length} ${t('unit.nodes')}`,
      `${map.edges.length} ${t('unit.edges')}`,
      ...(map.lanes.length > 0 ? [`${map.lanes.length} ${t('unit.lanes')}`] : []),
    ]
    return (
      <div className={css.panelBody}>
        <p className={css.panelTitle}>{map.title ?? 'mellos map'}</p>
        <p className={css.panelMeta}>{parts.join(' · ')}</p>
        {neutral ? (
          <p className={css.panelMeta}>{map.kind}</p>
        ) : (
          <p className={css.statusCounts}>
            {(['done', 'in-progress', 'planned', 'regressed'] as const)
              .filter(status => count(status) > 0)
              .map(status => (
                <span key={status} data-status={status}>{count(status)} {t(`status.${status}`)}</span>
              ))}
          </p>
        )}
        <p className={css.panelHint}>{t('dashboardHint')}</p>
      </div>
    )
  }

  if (info.kind === 'group') {
    return (
      <div className={css.panelBody}>
        <p className={css.panelHeader} data-status={info.status}>
          {info.group.label} <code>[{info.group.id as string}]</code> · {info.layerName} · {t(`status.${info.status}`)}
          {' '}· {info.members.length} {t('unit.members')}
          {pinned ? <span className={css.pinMark}>{t('pinned')}</span> : null}
        </p>
        <p className={css.wireRow}>
          <span className={css.detailKey}>{t('members')}</span>
          {info.members.map(member => (
            <span key={member.id as string} className={css.chip} data-status={member.status}>{member.label}</span>
          ))}
        </p>
        <WireRow word={usesWord} refs={info.uses} t={t} />
        <WireRow word={usedByWord} refs={info.usedBy} t={t} />
      </div>
    )
  }

  const { node } = info
  const headParts = [
    info.layerName,
    ...(info.laneLabel !== undefined ? [info.laneLabel] : []),
    ...(node.kind !== undefined ? [node.kind as string] : []),
    ...(neutral ? [] : [t(`status.${node.status}`)]),
    ...(node.submap !== undefined ? [`⊞ ${node.submap as string}`] : []),
  ]
  return (
    <div className={css.panelBody}>
      <p className={css.panelHeader} data-status={neutral ? 'neutral' : node.status}>
        {node.label} <code>[{node.id as string}]</code> · {headParts.join(' · ')}
        {pinned ? <span className={css.pinMark}>{t('pinned')}</span> : null}
      </p>
      {neutral ? null : (
        <p className={css.panelMeta}>
          {node.evidence !== undefined ? `${t('evidence')}: ${node.evidence}` : t('noEvidence')}
        </p>
      )}
      <WireRow word={usesWord} refs={info.uses} t={t} />
      <WireRow word={usedByWord} refs={info.usedBy} t={t} />
      <p className={css.panelNotes}>{node.detail ?? t('noNotes')}</p>
    </div>
  )
}
