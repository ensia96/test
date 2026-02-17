import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

type ModifierState = 'off' | 'once' | 'locked'

const GRUVBOX_THEME = {
  background: '#282828',
  foreground: '#ebdbb2',
  cursor: '#ebdbb2',
  black: '#282828',
  red: '#cc241d',
  green: '#98971a',
  yellow: '#d79921',
  blue: '#458588',
  magenta: '#b16286',
  cyan: '#689d6a',
  white: '#a89984',
  brightBlack: '#928374',
  brightRed: '#fb4934',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#83a598',
  brightMagenta: '#d3869b',
  brightCyan: '#8ec07c',
  brightWhite: '#ebdbb2',
}

const SPECIAL_KEYS: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  Delete: '\x1b[3~',
}

interface TerminalProps {
  wsUrl?: string
}

export default function Terminal({ wsUrl }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const inputAreaRef = useRef<HTMLTextAreaElement | null>(null)

  // 모디파이어 상태 (state + ref 동기화)
  const [ctrlState, setCtrlState] = useState<ModifierState>('off')
  const [optState, setOptState] = useState<ModifierState>('off')
  const ctrlRef = useRef<ModifierState>('off')
  const optRef = useRef<ModifierState>('off')

  // 키보드 높이
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // 더블클릭 감지
  const lastCtrlClick = useRef(0)
  const lastOptClick = useRef(0)
  const DOUBLE_CLICK_THRESHOLD = 300

  // state와 ref 동기화
  useEffect(() => { ctrlRef.current = ctrlState }, [ctrlState])
  useEffect(() => { optRef.current = optState }, [optState])

  // 키보드 높이 변경 시 fit() 재호출
  useEffect(() => {
    fitRef.current?.fit()
  }, [keyboardHeight])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      fontFamily: '"MesloLGS NF", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 2000,
      theme: GRUVBOX_THEME,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    const url = wsUrl || `ws://${window.location.host}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    // xterm textarea 봉인
    const xtermTextarea = containerRef.current.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
    if (xtermTextarea) {
      xtermTextarea.setAttribute('readonly', 'true')
      xtermTextarea.style.pointerEvents = 'none'
      xtermTextarea.tabIndex = -1
    }

    // 입력 textarea 생성
    const inputArea = document.createElement('textarea')
    inputArea.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      opacity: 0;
      z-index: 10;
      resize: none;
      border: none;
      outline: none;
      caret-color: transparent;
    `
    containerRef.current.appendChild(inputArea)
    inputAreaRef.current = inputArea

    // 포커스 복구
    if (xtermTextarea) {
      xtermTextarea.addEventListener('focus', () => inputArea.focus())
    }
    term.focus = () => inputArea.focus()

    // keydown: 모디파이어 조합 + 특수키 처리
    inputArea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

      const isCtrl = e.ctrlKey || ctrlRef.current !== 'off'
      const isOpt = e.altKey || optRef.current !== 'off'

      // Ctrl 조합
      if (isCtrl && !e.metaKey && !isOpt) {
        if (e.key.length === 1) {
          e.preventDefault()
          ws.send(String.fromCharCode(e.key.toLowerCase().charCodeAt(0) & 0x1f))
          resetOnceModifiers()
          return
        }
      }

      // Alt/Option 조합
      if (isOpt && !isCtrl && !e.metaKey) {
        e.preventDefault()

        switch (e.key) {
          case 'ArrowLeft': ws.send('\x1bb'); resetOnceModifiers(); return
          case 'ArrowRight': ws.send('\x1bf'); resetOnceModifiers(); return
          case 'Backspace': ws.send('\x1b\x7f'); resetOnceModifiers(); return
          case 'Delete': ws.send('\x1bd'); resetOnceModifiers(); return
        }

        if (e.code.startsWith('Key')) {
          const char = e.code.slice(3)
          ws.send('\x1b' + (e.shiftKey ? char.toUpperCase() : char.toLowerCase()))
          resetOnceModifiers()
          return
        }

        if (e.code.startsWith('Digit')) {
          const char = e.code.slice(5)
          ws.send('\x1b' + char)
          resetOnceModifiers()
          return
        }

        return
      }

      // 특수키
      const seq = SPECIAL_KEYS[e.key]
      if (seq) {
        e.preventDefault()
        ws.send(seq)
      }
    })

    // beforeinput: 텍스트 입력
    inputArea.addEventListener('beforeinput', (e: InputEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return

      if (e.inputType === 'insertText' && e.data) {
        ws.send(e.data)
      } else if (e.inputType === 'deleteContentBackward') {
        ws.send('\x7f')
      } else if (e.inputType === 'insertLineBreak') {
        ws.send('\r')
      }
    })

    // compositionend: textarea 정리
    inputArea.addEventListener('compositionend', () => {
      inputArea.value = ''
    })

    inputArea.focus()

    ws.onopen = () => {
      term.write('\x1b[32m[Connected]\x1b[0m\r\n')

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          term.write(e.data)
        } else if (e.data instanceof Blob) {
          e.data.text().then((text) => term.write(text))
        }
      }

      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onerror = () => {}
    ws.onclose = () => {
      term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n')
    }

    // 리사이즈 핸들러
    const handleResize = () => {
      if (window.visualViewport) {
        const height = window.innerHeight - window.visualViewport.height
        setKeyboardHeight(Math.max(0, height))
      }
      fit.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('scroll', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('scroll', handleResize)
      inputArea.remove()
      inputAreaRef.current = null
      ws.close()
      term.dispose()
    }
  }, [wsUrl])

  // 일회성 모디파이어 리셋
  const resetOnceModifiers = () => {
    if (ctrlRef.current === 'once') setCtrlState('off')
    if (optRef.current === 'once') setOptState('off')
  }

  const focusInput = () => inputAreaRef.current?.focus()

  // 모디파이어 클릭 핸들러
  const handleCtrlClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const now = Date.now()
    const isDoubleClick = now - lastCtrlClick.current < DOUBLE_CLICK_THRESHOLD
    lastCtrlClick.current = now

    setCtrlState(prev => {
      if (isDoubleClick) return prev === 'locked' ? 'off' : 'locked'
      return prev === 'off' ? 'once' : 'off'
    })
    focusInput()
  }

  const handleOptClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const now = Date.now()
    const isDoubleClick = now - lastOptClick.current < DOUBLE_CLICK_THRESHOLD
    lastOptClick.current = now

    setOptState(prev => {
      if (isDoubleClick) return prev === 'locked' ? 'off' : 'locked'
      return prev === 'off' ? 'once' : 'off'
    })
    focusInput()
  }

  // 키 전송
  const sendKey = (key: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const isCtrl = ctrlRef.current !== 'off'
    const isOpt = optRef.current !== 'off'

    // Ctrl + 키
    if (isCtrl && key.length === 1) {
      ws.send(String.fromCharCode(key.toLowerCase().charCodeAt(0) & 0x1f))
      resetOnceModifiers()
      return
    }

    // Opt + 특수키
    if (isOpt) {
      switch (key) {
        case 'ArrowLeft': ws.send('\x1bb'); resetOnceModifiers(); return
        case 'ArrowRight': ws.send('\x1bf'); resetOnceModifiers(); return
      }
      if (key.length === 1) {
        ws.send('\x1b' + key.toLowerCase())
        resetOnceModifiers()
        return
      }
    }

    // 일반 특수키
    const seq = SPECIAL_KEYS[key]
    if (seq) {
      ws.send(seq)
      resetOnceModifiers()
    }
  }

  const handleKeyClick = (key: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    sendKey(key)
    focusInput()
  }

  const getModifierStyle = (state: ModifierState): React.CSSProperties => ({
    ...buttonStyle,
    backgroundColor: state === 'off' ? '#3c3836' : state === 'once' ? '#504945' : '#665c54',
    borderColor: state === 'locked' ? '#fe8019' : '#504945',
    borderWidth: state === 'locked' ? 2 : 1,
  })

  return (
    <div style={{ height: `calc(100% - ${keyboardHeight}px)`, display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      />
      <div style={keybarStyle}>
        <div style={groupStyle}>
          <button style={buttonStyle} onMouseDown={handleKeyClick('Escape')} onTouchEnd={handleKeyClick('Escape')}>esc</button>
          <button style={getModifierStyle(ctrlState)} onMouseDown={handleCtrlClick} onTouchEnd={handleCtrlClick}>ctrl</button>
          <button style={getModifierStyle(optState)} onMouseDown={handleOptClick} onTouchEnd={handleOptClick}>opt</button>
          <button style={buttonStyle} onMouseDown={handleKeyClick('Tab')} onTouchEnd={handleKeyClick('Tab')}>tab</button>
        </div>
        <div style={groupStyle}>
          <button style={buttonStyle} onMouseDown={handleKeyClick('ArrowLeft')} onTouchEnd={handleKeyClick('ArrowLeft')}>←</button>
          <button style={buttonStyle} onMouseDown={handleKeyClick('ArrowDown')} onTouchEnd={handleKeyClick('ArrowDown')}>↓</button>
          <button style={buttonStyle} onMouseDown={handleKeyClick('ArrowUp')} onTouchEnd={handleKeyClick('ArrowUp')}>↑</button>
          <button style={buttonStyle} onMouseDown={handleKeyClick('ArrowRight')} onTouchEnd={handleKeyClick('ArrowRight')}>→</button>
        </div>
      </div>
    </div>
  )
}

const keybarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  height: 48,
  gap: 16,
  backgroundColor: '#1d2021',
  borderTop: '1px solid #3c3836',
  flexShrink: 0,
}

const groupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
}

const buttonStyle: React.CSSProperties = {
  width: 44,
  height: 36,
  border: '1px solid #504945',
  borderRadius: 6,
  backgroundColor: '#3c3836',
  color: '#ebdbb2',
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
  userSelect: 'none',
}
