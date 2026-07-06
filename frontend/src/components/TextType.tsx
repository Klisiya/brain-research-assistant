import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { gsap } from 'gsap'
import './TextType.css'

interface TextTypeProps {
  className?: string
  showCursor?: boolean
  hideCursorWhileTyping?: boolean
  cursorCharacter?: string | ReactNode
  cursorBlinkDuration?: number
  cursorClassName?: string
  text: string | string[]
  as?: ElementType
  typingSpeed?: number
  initialDelay?: number
  pauseDuration?: number
  deletingSpeed?: number
  loop?: boolean
  textColors?: string[]
  variableSpeed?: { min: number; max: number }
  onSentenceComplete?: (sentence: string, index: number) => void
  startOnVisible?: boolean
  reverseMode?: boolean
}

function TextType({
  text,
  as: Component = 'div',
  typingSpeed = 50,
  initialDelay = 0,
  pauseDuration = 2000,
  deletingSpeed = 30,
  loop = true,
  className = '',
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  cursorClassName = '',
  cursorBlinkDuration = 0.5,
  textColors = [],
  variableSpeed,
  onSentenceComplete,
  startOnVisible = false,
  reverseMode = false,
  ...props
}: TextTypeProps & HTMLAttributes<HTMLElement>) {
  const [displayedText, setDisplayedText] = useState('')
  const [currentCharIndex, setCurrentCharIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [currentTextIndex, setCurrentTextIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(!startOnVisible)
  const cursorRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLElement>(null)

  const textArray = useMemo(() => (Array.isArray(text) ? text : [text]), [text])

  const getRandomSpeed = useCallback(() => {
    if (!variableSpeed) {
      return typingSpeed
    }

    const { min, max } = variableSpeed
    return Math.random() * (max - min) + min
  }, [typingSpeed, variableSpeed])

  const getCurrentTextColor = () => {
    if (textColors.length === 0) {
      return 'inherit'
    }

    return textColors[currentTextIndex % textColors.length]
  }

  useEffect(() => {
    if (!startOnVisible || !containerRef.current) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
          }
        })
      },
      { threshold: 0.1 },
    )

    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [startOnVisible])

  useEffect(() => {
    if (!showCursor || !cursorRef.current) {
      return undefined
    }

    gsap.set(cursorRef.current, { opacity: 1 })
    const tween = gsap.to(cursorRef.current, {
      opacity: 0,
      duration: cursorBlinkDuration,
      repeat: -1,
      yoyo: true,
      ease: 'power2.inOut',
    })

    return () => {
      tween.kill()
    }
  }, [cursorBlinkDuration, showCursor])

  useEffect(() => {
    if (!isVisible) {
      return undefined
    }

    let timeout: ReturnType<typeof setTimeout>
    const currentText = textArray[currentTextIndex]
    const processedText = reverseMode ? currentText.split('').reverse().join('') : currentText

    const executeTypingAnimation = () => {
      if (isDeleting) {
        if (displayedText === '') {
          setIsDeleting(false)

          if (currentTextIndex === textArray.length - 1 && !loop) {
            return
          }

          setCurrentTextIndex((prev) => (prev + 1) % textArray.length)
          setCurrentCharIndex(0)
          timeout = setTimeout(() => undefined, pauseDuration)
        } else {
          timeout = setTimeout(() => {
            setDisplayedText((prev) => prev.slice(0, -1))
          }, deletingSpeed)
        }

        return
      }

      if (currentCharIndex < processedText.length) {
        timeout = setTimeout(
          () => {
            setDisplayedText((prev) => prev + processedText[currentCharIndex])
            setCurrentCharIndex((prev) => prev + 1)
          },
          variableSpeed ? getRandomSpeed() : typingSpeed,
        )
      } else {
        onSentenceComplete?.(textArray[currentTextIndex], currentTextIndex)

        if (!loop && currentTextIndex === textArray.length - 1) {
          return
        }

        timeout = setTimeout(() => {
          setIsDeleting(true)
        }, pauseDuration)
      }
    }

    if (currentCharIndex === 0 && !isDeleting && displayedText === '') {
      timeout = setTimeout(executeTypingAnimation, initialDelay)
    } else {
      executeTypingAnimation()
    }

    return () => clearTimeout(timeout)
  }, [
    currentCharIndex,
    currentTextIndex,
    deletingSpeed,
    displayedText,
    getRandomSpeed,
    initialDelay,
    isDeleting,
    isVisible,
    loop,
    onSentenceComplete,
    pauseDuration,
    reverseMode,
    textArray,
    typingSpeed,
    variableSpeed,
  ])

  const shouldHideCursor = hideCursorWhileTyping && (currentCharIndex < textArray[currentTextIndex].length || isDeleting)

  return createElement(
    Component,
    {
      className: `text-type ${className}`.trim(),
      ...props,
    },
    <span ref={containerRef} className="text-type__wrapper">
      <span className="text-type__content" style={{ color: getCurrentTextColor() || 'inherit' }}>
        {displayedText}
      </span>
      {showCursor && (
        <span
          ref={cursorRef}
          className={`text-type__cursor ${cursorClassName} ${
            shouldHideCursor ? 'text-type__cursor--hidden' : ''
          }`.trim()}
        >
          {cursorCharacter}
        </span>
      )}
    </span>,
  )
}

export default TextType
