import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

export default function Session({ websocketURL }: SessionProps) {
  const fitReference = useRef<FitAddon | null>(null);
  const inputReference = useRef<HTMLTextAreaElement | null>(null);
  const terminalReference = useRef<HTMLDivElement>(null);
  const termReference = useRef<Terminal | null>(null);
  const touchOverlayReference = useRef<HTMLDivElement>(null);
  const websocketReference = useRef<WebSocket | null>(null);

  const [state, setState] = useState<SessionState>({
    ctrl: 0,
    keyboard: 0,
    opt: 0,
  });
  const [selectedText, setSelectedText] = useState<string | null>(null);

  const handleModifier =
    (key: string) => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (key === "ctrl" || key === "opt")
        setState((state) => ({
          ...state,
          [key]: 2 * +(state[key] === 1) + +(state[key] === 0),
        }));
      else {
        let dataToSend;
        if (state.ctrl !== 0 && key.length === 1)
          dataToSend = String.fromCharCode(
            key.toLowerCase().charCodeAt(0) & 0x1f,
          );
        if (state.opt !== 0) {
          if (key === "ArrowLeft") dataToSend = "\x1bb";
          if (key === "ArrowRight") dataToSend = "\x1bf";
          if (key.length === 1) dataToSend = "\x1b" + key.toLowerCase();
        }
        if (!dataToSend) dataToSend = SPECIAL_KEYS[key];
        if (dataToSend) sendData(dataToSend);
      }
      inputReference.current?.focus();
    };

  const sendData: WebSocket["send"] = (data) => {
    const websocket = websocketReference.current;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(data);
    setState((state) => ({
      ...state,
      ctrl: state.ctrl === 1 ? 0 : state.ctrl,
      opt: state.opt === 1 ? 0 : state.opt,
    }));
  };

  const handleCopy = () => {
    const text = selectedText;
    if (!text) return;
    setSelectedText(null);
    termReference.current?.clearSelection();
    const fallbackCopy = (str: string) => {
      const textarea = document.createElement("textarea");
      textarea.value = str;
      textarea.style.cssText = "position:fixed;left:-9999px;";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  useEffect(() => {
    if (!terminalReference.current) return;

    // === Terminal 초기화 ===
    const term = new Terminal({
      fontFamily: '"MesloLGS NF", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: "#282828",
        black: "#282828",
        blue: "#458588",
        brightBlack: "#928374",
        brightBlue: "#83a598",
        brightCyan: "#8ec07c",
        brightGreen: "#b8bb26",
        brightMagenta: "#d3869b",
        brightRed: "#fb4934",
        brightWhite: "#ebdbb2",
        brightYellow: "#fabd2f",
        cursor: "#ebdbb2",
        cyan: "#689d6a",
        foreground: "#ebdbb2",
        green: "#98971a",
        magenta: "#b16286",
        red: "#cc241d",
        white: "#a89984",
        yellow: "#d79921",
      },
    });
    term.open(terminalReference.current);
    termReference.current = term;
    term.focus = () => inputReference.current?.focus();
    const xterm = terminalReference.current.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    );
    if (xterm) {
      xterm.addEventListener("focus", () => inputReference.current?.focus());
      xterm.setAttribute("readonly", "true");
      xterm.style.pointerEvents = "none";
      xterm.tabIndex = -1;
    }

    // === WebSocket 연결 ===
    websocketReference.current = new WebSocket(
      websocketURL ?? `ws://${window.location.host}`,
    );
    websocketReference.current.onclose = (e) => {
      term.write("\r\n\x1b[33m[Disconnected]\x1b[0m\r\n");
      // 의도적 종료(1000)가 아니면 2초 후 재연결
      if (e.code !== 1000) {
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    };
    websocketReference.current.onopen = () => {
      term.write("\x1b[32m[Connected]\x1b[0m\r\n");
      websocketReference.current!.onmessage = (e) => {
        if (typeof e.data === "string") term.write(e.data);
        else if (e.data instanceof Blob)
          e.data.text().then((text) => term.write(text));
      };
      websocketReference.current!.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    };

    // === 입력 처리 ===
    inputReference.current = document.createElement("textarea");
    inputReference.current.addEventListener("beforeinput", (e: InputEvent) => {
      if (websocketReference.current!.readyState !== WebSocket.OPEN) return;
      if (e.inputType === "insertText" && e.data) sendData(e.data);
      if (e.inputType === "insertFromPaste" && e.data)
        sendData(`\x1b[200~${e.data}\x1b[201~`);
      if (e.inputType === "deleteContentBackward") sendData("\x7f");
      if (e.inputType === "insertLineBreak") sendData("\r");
    });
    inputReference.current.addEventListener("compositionend", () => {
      inputReference.current!.value = "";
    });
    inputReference.current.addEventListener("keydown", (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (!e.metaKey)
        setState((state) => {
          const isCtrl = e.ctrlKey || state.ctrl !== 0;
          const isOpt = e.altKey || state.opt !== 0;
          let dataToSend;
          if (isCtrl && !isOpt && e.key.length === 1) {
            e.preventDefault();
            dataToSend = String.fromCharCode(
              e.key.toLowerCase().charCodeAt(0) & 0x1f,
            );
          }
          if (isOpt) {
            e.preventDefault();
            if (e.key === "ArrowLeft") dataToSend = "\x1bb";
            if (e.key === "ArrowRight") dataToSend = "\x1bf";
            if (e.key === "Backspace") dataToSend = "\x1b\x7f";
            if (e.key === "Delete") dataToSend = "\x1bd";
            if (e.code.startsWith("Key")) {
              const ch =
                e.code.slice(3)[e.shiftKey ? "toUpperCase" : "toLowerCase"]();
              dataToSend = isCtrl
                ? "\x1b" + String.fromCharCode(ch.charCodeAt(0) & 0x1f)
                : "\x1b" + ch;
            }
            if (e.code.startsWith("Digit"))
              dataToSend = "\x1b" + e.code.slice(5);
            const sym = OPT_CODE_MAP[e.code];
            if (sym) {
              const ch = sym[+e.shiftKey];
              dataToSend = isCtrl
                ? "\x1b" + String.fromCharCode(ch.charCodeAt(0) & 0x1f)
                : "\x1b" + ch;
            }
          }
          if (!dataToSend) dataToSend = SPECIAL_KEYS[e.key];
          if (dataToSend) {
            e.preventDefault();
            sendData(dataToSend);
          }
          return state;
        });
    });
    inputReference.current.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      opacity: 0;
      z-index: 10;
      resize: none;
      border: none;
      outline: none;
      caret-color: transparent;
    `;
    terminalReference.current.appendChild(inputReference.current);
    inputReference.current.focus();

    // === FitAddon 설정 ===
    const fit = new FitAddon();
    fitReference.current = fit;
    term.loadAddon(fit);
    term.loadAddon(
      new ClipboardAddon(undefined, {
        async readText() {
          return navigator.clipboard.readText();
        },
        async writeText(_selection: string, text: string) {
          setSelectedText(text);
        },
      }),
    );
    fit.fit();
    const handleResize = () => {
      if (!terminalReference.current) return;
      if (websocketReference.current?.readyState !== WebSocket.OPEN) return;
      if (window.visualViewport)
        setState((state) => ({
          ...state,
          keyboard: Math.max(
            window.innerHeight - window.visualViewport!.height,
            0,
          ),
        }));
      else {
        fit.fit();
        websocketReference.current!.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      }
    };
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);

    // === 터치 오버레이 처리 ===
    const overlay = touchOverlayReference.current;
    let onTouchStart: ((e: TouchEvent) => void) | undefined;
    let onTouchMove: ((e: TouchEvent) => void) | undefined;
    let onTouchEnd: ((e: TouchEvent) => void) | undefined;
    if (overlay) {
      const TAP_THRESHOLD = 15;
      const TAP_TIMEOUT = 300;
      const LONGPRESS_THRESHOLD = 10;
      const PX_PER_LINE = 20;
      const VELOCITY_THRESHOLD = 0.5;
      const FRICTION = 0.95;

      let startX = 0;
      let startY = 0;
      let startTime = 0;
      let touchMode: "none" | "tap" | "longpress" | "drag" | "scroll" = "none";
      let dragStartCol = 0;
      let dragStartRow = 0;
      let scrollAccumulated = 0;
      let velocityY = 0;
      let lastY = 0;
      let lastTime = 0;
      let momentumId = 0;
      let longpressTimer = 0;

      const getCell = (x: number, y: number) => {
        const rect = terminalReference.current!.getBoundingClientRect();
        const cellWidth = rect.width / term.cols;
        const cellHeight = rect.height / term.rows;
        return {
          col: Math.floor((x - rect.left) / cellWidth),
          row: Math.floor((y - rect.top) / cellHeight),
        };
      };

      const copySelection = () => {
        const text = term.getSelection();
        if (!text) return;
        const fallbackCopy = (str: string) => {
          const textarea = document.createElement("textarea");
          textarea.value = str;
          textarea.style.cssText = "position:fixed;opacity:0;";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
          fallbackCopy(text);
        }
      };

      const scrollUp = () => {
        sendData(
          `\x1b[<64;${Math.floor(term.cols / 2)};${Math.floor(term.rows / 2)}M`,
        );
        term.scrollLines(-1);
      };

      const scrollDown = () => {
        sendData(
          `\x1b[<65;${Math.floor(term.cols / 2)};${Math.floor(term.rows / 2)}M`,
        );
        term.scrollLines(1);
      };

      const animateMomentum = () => {
        if (Math.abs(velocityY) < VELOCITY_THRESHOLD) return;
        const lines = Math.trunc(velocityY / PX_PER_LINE);
        if (lines > 0) for (let i = 0; i < lines; i++) scrollDown();
        else if (lines < 0) for (let i = 0; i < -lines; i++) scrollUp();
        velocityY *= FRICTION;
        momentumId = requestAnimationFrame(animateMomentum);
      };

      onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedText(null);
        if (e.touches.length === 1) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          startTime = Date.now();
          touchMode = "tap";
          term.clearSelection();
          const { col, row } = getCell(startX, startY);
          dragStartCol = col;
          dragStartRow = row;
          clearTimeout(longpressTimer);
          longpressTimer = window.setTimeout(() => {
            if (touchMode === "tap") {
              touchMode = "longpress";
              navigator.vibrate?.(50);
            }
          }, TAP_TIMEOUT);
        } else if (e.touches.length === 2) {
          cancelAnimationFrame(momentumId);
          touchMode = "scroll";
          const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          startY = avgY;
          lastY = avgY;
          lastTime = Date.now();
          scrollAccumulated = 0;
          velocityY = 0;
        }
      };

      onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          (touchMode === "tap" || touchMode === "longpress") &&
          e.touches.length === 1
        ) {
          const dx = e.touches[0].clientX - startX;
          const dy = e.touches[0].clientY - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > LONGPRESS_THRESHOLD) {
            clearTimeout(longpressTimer);
            if (
              touchMode === "tap" &&
              (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD)
            ) {
              cancelAnimationFrame(momentumId);
              touchMode = "scroll";
              lastY = e.touches[0].clientY;
              lastTime = Date.now();
              scrollAccumulated = 0;
              velocityY = 0;
            } else if (touchMode === "longpress") {
              touchMode = "drag";
            }
          }
        }
        if (touchMode === "drag" && e.touches.length === 1) {
          const { col, row } = getCell(
            e.touches[0].clientX,
            e.touches[0].clientY,
          );
          const startOffset = dragStartRow * term.cols + dragStartCol;
          const currentOffset = row * term.cols + col;
          if (currentOffset >= startOffset) {
            term.select(
              dragStartCol,
              dragStartRow,
              currentOffset - startOffset + 1,
            );
          } else {
            term.select(col, row, startOffset - currentOffset + 1);
          }
        } else if (touchMode === "scroll") {
          const currentY =
            e.touches.length === 2
              ? (e.touches[0].clientY + e.touches[1].clientY) / 2
              : e.touches[0].clientY;
          const now = Date.now();
          const dt = now - lastTime;
          if (dt > 0) velocityY = ((lastY - currentY) / dt) * 16;
          lastY = currentY;
          lastTime = now;

          const deltaY = startY - currentY;
          startY = currentY;
          scrollAccumulated += deltaY;
          const lines = Math.trunc(scrollAccumulated / PX_PER_LINE);
          if (lines !== 0) {
            scrollAccumulated -= lines * PX_PER_LINE;
            if (lines > 0) for (let i = 0; i < lines; i++) scrollDown();
            else for (let i = 0; i < -lines; i++) scrollUp();
          }
        }
      };

      onTouchEnd = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(longpressTimer);
        if (touchMode === "tap" && Date.now() - startTime < TAP_TIMEOUT) {
          const { col, row } = getCell(startX, startY);
          sendData(`\x1b[<0;${col + 1};${row + 1}M`);
          sendData(`\x1b[<0;${col + 1};${row + 1}m`);
        } else if (touchMode === "longpress") {
          inputReference.current?.focus();
        } else if (touchMode === "drag") {
          const text = term.getSelection();
          if (text) setSelectedText(text);
        } else if (touchMode === "scroll") {
          animateMomentum();
        }
        touchMode = "none";
      };

      overlay.addEventListener("touchstart", onTouchStart, { passive: false });
      overlay.addEventListener("touchmove", onTouchMove, { passive: false });
      overlay.addEventListener("touchend", onTouchEnd, { passive: false });
      overlay.addEventListener("touchcancel", onTouchEnd, { passive: false });
    }

    // === Visibility Change 핸들러 ===
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const ws = websocketReference.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          window.location.reload();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // === Cleanup ===
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
      if (overlay && onTouchStart && onTouchMove && onTouchEnd) {
        overlay.removeEventListener("touchstart", onTouchStart);
        overlay.removeEventListener("touchmove", onTouchMove);
        overlay.removeEventListener("touchend", onTouchEnd);
        overlay.removeEventListener("touchcancel", onTouchEnd);
      }
      fitReference.current = null;
      inputReference.current?.remove();
      inputReference.current = null;
      websocketReference.current?.close();
      term.dispose();
    };
  }, [websocketURL]);

  useEffect(() => {
    const fit = fitReference.current;
    if (!fit) return;
    termReference.current?.clearSelection();
    fit.fit();
    const websocket = websocketReference.current;
    if (websocket?.readyState !== WebSocket.OPEN) return;
    const dimensions = fit.proposeDimensions();
    if (!dimensions) return;
    websocket.send(JSON.stringify({ type: "resize", ...dimensions }));
  }, [state.keyboard]);

  return (
    <div
      {...{
        style: {
          display: "flex",
          flexDirection: "column",
          height: `calc(100% - ${state.keyboard}px)`,
        },
      }}
    >
      <div
        {...{
          ref: terminalReference,
          style: {
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
          },
        }}
      >
        <div
          {...{
            ref: touchOverlayReference,
            style: {
              background: "transparent",
              bottom: 0,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
              touchAction: "none",
              zIndex: 20,
            },
          }}
        />
      </div>

      <div {...{ style: STYLE.KEYBAR }}>
        <div {...{ style: STYLE.GROUP }}>
          {[
            {
              children: "esc",
              handler: handleModifier("Escape"),
              style: STYLE.BUTTON,
            },
            {
              children: "ctrl",
              handler: handleModifier("ctrl"),
              style: getModifierStyle(state.ctrl),
            },
            {
              children: "opt",
              handler: handleModifier("opt"),
              style: getModifierStyle(state.opt),
            },
            {
              children: "tab",
              handler: handleModifier("Tab"),
              style: STYLE.BUTTON,
            },
          ].map(({ children, handler, style }) => (
            <button
              {...{
                children,
                key: children,
                onMouseDown: handler,
                onTouchEnd: handler,
                style,
              }}
            />
          ))}
        </div>

        <div {...{ style: STYLE.GROUP }}>
          {selectedText && (
            <button
              {...{
                children: "copy",
                onMouseDown: (e: React.MouseEvent) => {
                  e.preventDefault();
                  handleCopy();
                },
                onTouchEnd: (e: React.TouchEvent) => {
                  e.preventDefault();
                  handleCopy();
                },
                style: STYLE.BUTTON,
              }}
            />
          )}
          {[
            {
              children: "←",
              handler: handleModifier("ArrowLeft"),
              style: STYLE.BUTTON,
            },
            {
              children: "↓",
              handler: handleModifier("ArrowDown"),
              style: STYLE.BUTTON,
            },
            {
              children: "↑",
              handler: handleModifier("ArrowUp"),
              style: STYLE.BUTTON,
            },
            {
              children: "→",
              handler: handleModifier("ArrowRight"),
              style: STYLE.BUTTON,
            },
          ].map(({ children, handler, style }) => (
            <button
              {...{
                children,
                key: children,
                onMouseDown: handler,
                onTouchEnd: handler,
                style,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type ModifierState = 0 | 1 | 2;

type SessionProps = {
  websocketURL?: string;
};

type SessionState = {
  ctrl: ModifierState;
  keyboard: number;
  opt: ModifierState;
};

const OPT_CODE_MAP: Record<string, [string, string]> = {
  Backquote: ["`", "~"],
  Backslash: ["\\", "|"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Comma: [",", "<"],
  Equal: ["=", "+"],
  Minus: ["-", "_"],
  Period: [".", ">"],
  Quote: ["'", '"'],
  Semicolon: [";", ":"],
  Slash: ["/", "?"],
};

const SPECIAL_KEYS: Record<string, string> = {
  ArrowDown: "\x1b[B",
  ArrowLeft: "\x1b[D",
  ArrowRight: "\x1b[C",
  ArrowUp: "\x1b[A",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  End: "\x1b[F",
  Enter: "\r",
  Escape: "\x1b",
  Home: "\x1b[H",
  Tab: "\t",
};

const STYLE: Record<string, React.CSSProperties> = {
  BUTTON: {
    WebkitTapHighlightColor: "transparent",
    alignItems: "center",
    backgroundColor: "#3c3836",
    border: "1px solid #504945",
    borderRadius: 6,
    color: "#ebdbb2",
    cursor: "pointer",
    display: "flex",
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: "center",
    touchAction: "manipulation",
    userSelect: "none",
    width: 44,
  },
  GROUP: {
    display: "flex",
    gap: 8,
  },
  KEYBAR: {
    alignItems: "center",
    backgroundColor: "#1d2021",
    borderTop: "1px solid #3c3836",
    display: "flex",
    flexShrink: 0,
    gap: 16,
    height: 48,
    justifyContent: "space-between",
  },
};

function getModifierStyle(state: ModifierState): React.CSSProperties {
  return {
    ...STYLE.BUTTON,
    backgroundColor: ["#3c3836", "#504945", "#665c54"][state],
    borderColor: ["#504945", "#fe8019"][+(state === 2)],
    borderWidth: 1 + +(state === 2),
  };
}
