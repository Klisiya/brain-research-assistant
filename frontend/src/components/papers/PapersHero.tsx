type PapersHeroProps = {
  difficultyLevelCount: number
  resourceCount: number
  topicCount: number
}

function PapersHero({
  difficultyLevelCount,
  resourceCount,
  topicCount,
}: PapersHeroProps) {
  return (
    <section className="papers-hero">
      <span className="papers-eyebrow">Research Library</span>
      <h1>Explore Brain Research Papers</h1>
      <p className="papers-hero-description">
        Discover foundational studies, review articles, and guided learning resources
        selected for structured brain science study.
      </p>

      <dl className="papers-hero-stats">
        <div>
          <dt>{resourceCount}</dt>
          <dd>Curated Resources</dd>
        </div>
        <div>
          <dt>{topicCount}</dt>
          <dd>Research Topics</dd>
        </div>
        <div>
          <dt>{difficultyLevelCount} Levels</dt>
          <dd>Beginner to Advanced</dd>
        </div>
      </dl>

      <p className="papers-demo-note">
        Demo metadata is used for this front-end preview and does not represent
        instructor approval or a connected publication database.
      </p>
    </section>
  )
}

export default PapersHero
