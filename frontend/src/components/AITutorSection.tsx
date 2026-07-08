import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
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

const NETWORK_ERROR_MESSAGE = 'Network error. Please check your connection and try again.'
const TEMPORARY_ERROR_MESSAGE = 'The AI Tutor is temporarily unavailable. Please try again.'
const INVALID_REQUEST_MESSAGE = 'Please enter a valid question and try again.'
const UNEXPECTED_RESPONSE_MESSAGE = 'The AI Tutor returned an unexpected response. Please try again.'
const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please sign in and try again.'

class AuthRequiredError extends Error {
  loginUrl: string

  constructor(loginUrl: string) {
    super(AUTH_REQUIRED_MESSAGE)
    this.name = 'AuthRequiredError'
    this.loginUrl = loginUrl
  }
}

const MARKDOWN_COMPONENTS: Components = {
  a({ children, href, title }) {
    const isExternalLink = Boolean(href && /^https?:\/\//i.test(href))

    return (
      <a href={href} rel={isExternalLink ? 'noreferrer' : undefined} target={isExternalLink ? '_blank' : undefined} title={title}>
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="ai-message-table-scroll">
        <table>{children}</table>
      </div>
    )
  },
}

type StreamingMarkdownProps = {
  text: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function getRequestErrorMessage(status: number) {
  if (status === 400) {
    return INVALID_REQUEST_MESSAGE
  }

  if (status === 503) {
    return TEMPORARY_ERROR_MESSAGE
  }

  return TEMPORARY_ERROR_MESSAGE
}

function getReplyFromPayload(payload: unknown) {
  if (!isRecord(payload) || typeof payload.reply !== 'string') {
    return null
  }

  const reply = payload.reply.trim()

  return reply ? payload.reply : null
}

function isAuthRequiredPayload(payload: unknown): payload is { code: 'AUTH_REQUIRED'; login_url: string } {
  return isRecord(payload) && payload.code === 'AUTH_REQUIRED' && typeof payload.login_url === 'string' && Boolean(payload.login_url)
}

function getSameOriginLoginPath(loginUrl: string) {
  try {
    const url = new URL(loginUrl, window.location.origin)

    if (url.origin === window.location.origin && url.pathname === '/login' && !url.search && !url.hash) {
      return '/login'
    }
  } catch {
    return null
  }

  return null
}

async function requestTutorReply(message: string, signal: AbortSignal) {
  let response: Response

  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }

    throw new Error(NETWORK_ERROR_MESSAGE, { cause: error })
  }

  const payload = await readJsonPayload(response)

  if (response.status === 401 && isAuthRequiredPayload(payload)) {
    throw new AuthRequiredError(payload.login_url)
  }

  if (!response.ok) {
    throw new Error(getRequestErrorMessage(response.status))
  }

  const reply = getReplyFromPayload(payload)

  if (!reply) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  return reply
}

function useStreamedText(text: string, speed = 28, characterChunkSize = 2) {
  const [displayedText, setDisplayedText] = useState('')

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!text) {
      return undefined
    }

    let currentIndex = 0
    let lastFrameTime = 0
    let animationFrameId: number | null = null
    const chunkSize = Math.max(1, characterChunkSize)
    const frameDelay = Math.max(1, speed)

    if (prefersReducedMotion) {
      animationFrameId = window.requestAnimationFrame(() => {
        setDisplayedText(text)
      })

      return () => {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId)
        }
      }
    }

    const streamText = (timestamp: number) => {
      if (timestamp - lastFrameTime < frameDelay) {
        animationFrameId = window.requestAnimationFrame(streamText)
        return
      }

      lastFrameTime = timestamp
      currentIndex = Math.min(currentIndex + chunkSize, text.length)
      setDisplayedText(text.slice(0, currentIndex))

      if (currentIndex < text.length) {
        animationFrameId = window.requestAnimationFrame(streamText)
      }
    }

    animationFrameId = window.requestAnimationFrame(streamText)

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [characterChunkSize, speed, text])

  return displayedText
}

function StreamingMarkdown({ text }: StreamingMarkdownProps) {
  const displayedText = useStreamedText(text)

  return (
    <ReactMarkdown components={MARKDOWN_COMPONENTS} remarkPlugins={[remarkGfm]}>
      {displayedText}
    </ReactMarkdown>
  )
}

function AITutorSection() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [exchange, setExchange] = useState<TutorExchange | null>(null)
  const [isPlaceholderTyped, setIsPlaceholderTyped] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const requestControllerRef = useRef<AbortController | null>(null)
  const isSubmittingRef = useRef(false)
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

  const scheduleResizeQuestionInput = () => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      resizeQuestionInput()
    })
  }

  const submitQuestion = async (rawQuestion: string) => {
    const trimmedQuestion = rawQuestion.trim()

    if (!trimmedQuestion || isLoading || isSubmittingRef.current) {
      return
    }

    const controller = new AbortController()
    requestControllerRef.current = controller
    isSubmittingRef.current = true
    setIsLoading(true)
    setExchange({
      question: trimmedQuestion,
      answer: '',
    })

    try {
      const reply = await requestTutorReply(trimmedQuestion, controller.signal)

      setExchange({
        question: trimmedQuestion,
        answer: reply,
      })
      setQuestion('')
      setIsPlaceholderTyped(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      if (error instanceof AuthRequiredError) {
        const loginPath = getSameOriginLoginPath(error.loginUrl)

        if (loginPath) {
          navigate(loginPath, { state: { authRequired: true } })
        } else {
          window.location.assign(error.loginUrl)
        }

        return
      }

      setExchange({
        question: trimmedQuestion,
        answer: error instanceof Error ? error.message : TEMPORARY_ERROR_MESSAGE,
      })
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null
      }

      isSubmittingRef.current = false

      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    }
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
      requestControllerRef.current?.abort()

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
        edgeSensitivity={30}
        glowColor="194 96 76"
        backgroundColor="#120F17"
        borderRadius={28}
        glowRadius={18}
        glowIntensity={1.12}
        coneSpread={30}
        fillOpacity={0.22}
        animated
        colors={['#38bdf8', '#a855f7', '#fff7d6']}
      >
        <div className={`ai-tutor-shell${hasChat ? ' has-chat' : ''}`}>
          <header className="ai-tutor-heading">
            <h2 className="ai-tutor-title">Ready to explore the brain?</h2>
            <p className="ai-tutor-subtitle">Ask a question</p>
          </header>

          <div className={`ai-conversation-panel${hasChat ? ' has-chat' : ''}`}>
            {hasChat ? (
              <div className="ai-chat-log" id="chatWindow" ref={chatLogRef}>
                {exchange ? (
                  <>
                    <div className="ai-chat-message ai-chat-message-user">
                      <div className="ai-message-avatar">You</div>
                      <div className="ai-message-bubble">{exchange.question}</div>
                    </div>

                    {exchange.answer ? (
                      <>
                        <div className="ai-answer-divider" aria-hidden="true" />
                        <div className="ai-chat-message ai-chat-message-assistant">
                          <div className="ai-message-bubble ai-message-markdown ai-generated-answer">
                            <StreamingMarkdown text={exchange.answer} />
                          </div>
                        </div>
                      </>
                    ) : null}
                  </>
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
                  <span className={`ai-tutor-status${isLoading ? ' ai-shining-thinking' : ''}`} aria-live="polite">
                    {isLoading ? 'Brain Science Tutor is thinking...' : 'Brain Science Tutor'}
                  </span>
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
          </div>

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
