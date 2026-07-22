type ModulesMetricsTextProps = {
  moduleCount: number
  thematicAreaCount: number
  totalHours: number
}

function ModulesMetricsText({
  moduleCount,
  thematicAreaCount,
  totalHours,
}: ModulesMetricsTextProps) {
  return (
    <div className="modules-metrics">
      <span className="modules-metrics-eyebrow">
        Frontiers in Brain Science and Brain-Inspired Intelligence
      </span>
      <h2 id="modules-morph-heading">
        <strong>{moduleCount}</strong> Learning Modules
      </h2>
      <p className="modules-metrics-support" aria-label="Course structure summary">
        <span><strong>{thematicAreaCount}</strong> Thematic Areas</span>
        <span aria-hidden="true">·</span>
        <span><strong>{totalHours}</strong> Total Hours</span>
        <span aria-hidden="true">·</span>
        <span>Theory + Practice</span>
      </p>
    </div>
  )
}

export default ModulesMetricsText
