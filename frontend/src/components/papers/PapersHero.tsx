import type { Paper } from '../../types/paper'
import PaperMarqueeWall from './PaperMarqueeWall'

type PapersHeroProps = {
  difficultyLevelCount: number
  loading?: boolean
  papers: readonly Paper[]
  resourceCount: number
  topicCount: number
}

function PapersHero({
  difficultyLevelCount,
  loading = false,
  papers,
  resourceCount,
  topicCount,
}: PapersHeroProps) {
  return (
    <section className="papers-hero">
      <div className="papers-hero-showcase">
        <div className="papers-hero-copy">
          <span className="papers-eyebrow">Research Library</span>
          <h1>Explore Brain Research Papers</h1>
        </div>

        <PaperMarqueeWall loading={loading} papers={papers} />
      </div>

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
        Browse published learning materials from the Brain Research Tutor library.
      </p>
    </section>
  )
}

export default PapersHero
