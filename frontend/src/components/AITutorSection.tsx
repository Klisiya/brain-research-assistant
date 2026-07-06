import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import BorderGlow from './BorderGlow'
import TextType from './TextType'
import './AITutorSection.css'

type Prompt = {
  label: string
  question: string
}

type TutorExchange = {
  question: string
  answer: string
}

const QUICK_PROMPTS: Prompt[] = [
  {
    label: 'Brain-Computer Interface',
    question: 'What is a brain-computer interface?',
  },
  {
    label: 'Brain-Inspired Intelligence',
    question: 'How is brain-inspired intelligence different from artificial intelligence?',
  },
  {
    label: 'Neural Communication',
    question: 'How do neurons transmit information?',
  },
  {
    label: 'Memory and Learning',
    question: 'What is the relationship between memory and learning in the brain?',
  },
]

function createMockTutorResponse(question: string) {
  return `This is a mock tutor response for: "${question}"\n\nIn the next migration step, this responder can be replaced with the existing /api/chat behavior while keeping this interface unchanged.`
}

function AITutorSection() {
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [exchange, setExchange] = useState<TutorExchange | null>(null)
  const [isPlaceholderTyped, setIsPlaceholderTyped] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)

  const resizeQuestionInput = () => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    const computedMinHeight = parseFloat(window.getComputedStyle(textarea).minHeight)
    const minHeight = Number.isFinite(computedMinHeight) ? computedMinHeight : 96
    const maxHeight = 220

    textarea.style.height = `${minHeight}px`
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))

    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  const clearMockTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const scheduleResizeQuestionInput = () => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      resizeQuestionInput()
    })
  }

  const submitQuestion = (rawQuestion: string) => {
    const trimmedQuestion = rawQuestion.trim()

    if (!trimmedQuestion || isLoading) {
      return
    }

    clearMockTimer()
    setQuestion('')
    setIsPlaceholderTyped(false)
    setIsLoading(true)
    setExchange({
      question: trimmedQuestion,
      answer: '',
    })

    const delay = 600 + Math.round(Math.random() * 300)

    timerRef.current = window.setTimeout(() => {
      setExchange({
        question: trimmedQuestion,
        answer: createMockTutorResponse(trimmedQuestion),
      })
      setIsLoading(false)
      timerRef.current = null
    }, delay)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitQuestion(question)
  }

  const handleInput = (value: string) => {
    setQuestion(value)
    if (value) {
      setIsPlaceholderTyped(false)
    }
    scheduleResizeQuestionInput()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitQuestion(question)
    }
  }

  const handlePromptClick = (promptQuestion: string) => {
    if (isLoading) {
      return
    }

    setQuestion(promptQuestion)
    setIsPlaceholderTyped(false)
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      resizeQuestionInput()
      textareaRef.current?.focus()
    })
  }

  const handlePlaceholderComplete = useCallback(() => {
    setIsPlaceholderTyped(true)
  }, [])

  useEffect(() => {
    resizeQuestionInput()
  }, [question])

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTo({
        top: chatLogRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [exchange, isLoading])

  useEffect(() => {
    return () => {
      clearMockTimer()

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  const canSend = Boolean(question.trim()) && !isLoading
  const hasChat = Boolean(exchange)
  const composerClassName = ['ai-composer', isLoading ? 'is-submitting' : '', question ? 'has-value' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <section className="ai-section" id="ai-section">
      <BorderGlow
        className="ai-tutor-border-glow"
        edgeSensitivity={66}
        glowColor="40 80 80"
        backgroundColor="#120F17"
        borderRadius={28}
        glowRadius={46}
        glowIntensity={0.8}
        coneSpread={34}
        animated
        colors={['#fff7d6', '#a855f7', '#38bdf8']}
      >
        <div className={`ai-tutor-shell${hasChat ? ' has-chat' : ''}`}>
          <header className="ai-tutor-heading">
            <h2 className="ai-tutor-title">Ready to explore the brain?</h2>
            <p className="ai-tutor-subtitle">Ask a question</p>
          </header>

          {exchange ? (
            <div className="ai-chat-log" id="chatWindow" ref={chatLogRef}>
              <div className="ai-chat-message ai-chat-message-user">
                <div className="ai-message-avatar">You</div>
                <div className="ai-message-bubble">{exchange.question}</div>
              </div>

              {exchange.answer ? (
                <div className="ai-chat-message ai-chat-message-assistant">
                  <div className="ai-message-avatar">AI</div>
                  <div className="ai-message-bubble">{exchange.answer}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <form className={composerClassName} aria-busy={isLoading} onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="questionInput">
              Ask a question
            </label>
            <textarea
              ref={textareaRef}
              className="ai-composer-input ai-tutor-input"
              id="questionInput"
              name="question"
              placeholder=""
              rows={1}
              required
              readOnly={isLoading}
              value={question}
              onChange={(event) => handleInput(event.target.value)}
              onKeyDown={handleKeyDown}
            />

            {!question && !isLoading ? (
              <div className="ai-typing-placeholder" aria-hidden="true">
                <TextType
                  as="span"
                  className="ai-placeholder-text"
                  cursorCharacter="_"
                  cursorBlinkDuration={0.7}
                  loop={false}
                  onSentenceComplete={handlePlaceholderComplete}
                  showCursor={!isPlaceholderTyped}
                  startOnVisible
                  text="Ask a question about brain science or brain-inspired intelligence"
                  typingSpeed={150}
                />
                {isPlaceholderTyped ? (
                  <span className="ai-placeholder-dots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="ai-composer-bar">
              <div className="ai-composer-meta">
                <span className="ai-tutor-status">Brain Science Tutor</span>
                <div className="ai-composer-loading" aria-live="polite" hidden={!isLoading}>
                  <span>AI is thinking</span>
                  <div className="loading-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>

              <button className="ai-send-button ai-tutor-send" type="submit" aria-label="Send question" disabled={!canSend}>
                {isLoading ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />
                    <span>Thinking...</span>
                  </>
                ) : (
                  <>
                    <svg className="send-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12L19 5L14 19L11 13L5 12Z" />
                    </svg>
                    <span className="send-label">Send</span>
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="ai-quick-prompts" aria-label="Suggested brain science questions">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                className="ai-tutor-suggestion"
                key={prompt.label}
                type="button"
                onClick={() => handlePromptClick(prompt.question)}
                disabled={isLoading}
              >
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      </BorderGlow>
    </section>
  )
}

export default AITutorSection
