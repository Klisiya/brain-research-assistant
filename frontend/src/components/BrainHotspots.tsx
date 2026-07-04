import type { RefObject } from 'react'
import './BrainHotspots.css'

type BrainHotspotsProps = {
  lineLayerRef: RefObject<SVGSVGElement | null>
  labelLayerRef: RefObject<HTMLDivElement | null>
}

function BrainHotspots({ lineLayerRef, labelLayerRef }: BrainHotspotsProps) {
  return (
    <>
      <svg ref={lineLayerRef} className="brain-region-lines" aria-hidden="true" />
      <div ref={labelLayerRef} className="brain-region-label-layer" aria-label="Brain region labels" />
    </>
  )
}

export default BrainHotspots
