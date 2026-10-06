type ModulesMetricsTextProps = {
  courseTitle: string
  moduleCount: number
  thematicAreaCount: number
  totalHours: number
}

function ModulesMetricsText({
  courseTitle,
  moduleCount,
  thematicAreaCount,
  totalHours,
}: ModulesMetricsTextProps) {
  return (
    <div className="modules-metrics">
      {courseTitle && <span className="modules-metrics-eyebrow">
        {courseTitle}
      </span>}
      <h2 id="modules-morph-heading">
        <strong>{moduleCount}</strong> Learning Modules
      </h2>
      <p className="modules-metrics-support" aria-label="Course structure summary">
        {thematicAreaCount > 0 && <><span><strong>{thematicAreaCount}</strong> Thematic Areas</span>
        <span aria-hidden="true">·</span></>}
        <span><strong>{totalHours}</strong> Total Hours</span>
      </p>
    </div>
  )
}

export default ModulesMetricsText
